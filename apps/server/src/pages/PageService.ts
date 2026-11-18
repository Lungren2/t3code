import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import {
  type Page,
  PageConflictError,
  type PageCreateInput,
  type PageDeleteResult,
  PageError,
  type PageGenerateEditInput,
  type PageGenerateEditResult,
  PageId,
  type PageListResult,
  type PageMoveInput,
  PageNotFoundError,
  type PageSummary,
  type PageUpdateInput,
  type TextGenerationError,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export type PageServiceError = PageNotFoundError | PageConflictError | PageError;

export class PageService extends Context.Service<
  PageService,
  {
    readonly list: Effect.Effect<PageListResult, PageError>;
    readonly subscribe: () => Stream.Stream<PageListResult, PageError>;
    readonly get: (id: PageId) => Effect.Effect<Page, PageNotFoundError | PageError>;
    readonly create: (input: PageCreateInput) => Effect.Effect<Page, PageServiceError>;
    readonly update: (input: PageUpdateInput) => Effect.Effect<Page, PageServiceError>;
    readonly move: (input: PageMoveInput) => Effect.Effect<Page, PageServiceError>;
    readonly remove: (id: PageId) => Effect.Effect<PageDeleteResult, PageServiceError>;
    readonly restore: (id: PageId) => Effect.Effect<Page, PageServiceError>;
    readonly generateEdit: (
      input: PageGenerateEditInput,
    ) => Effect.Effect<PageGenerateEditResult, PageServiceError | TextGenerationError>;
  }
>()("t3/pages/PageService") {}

const PageRow = Schema.Struct({
  page_id: PageId,
  parent_id: Schema.NullOr(PageId),
  title: Schema.String,
  icon: Schema.NullOr(Schema.String),
  markdown: Schema.String,
  position: Schema.Number,
  revision: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
  deleted_at: Schema.NullOr(Schema.String),
  deletion_id: Schema.NullOr(Schema.String),
});
type PageRow = typeof PageRow.Type;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(PageRow));

const toSummary = (row: PageRow): PageSummary => ({
  id: row.page_id,
  parentId: row.parent_id,
  title: row.title,
  icon: row.icon,
  position: row.position,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPage = (row: PageRow): Page => ({ ...toSummary(row), markdown: row.markdown });

/** Deleted pages stay restorable this long, then are purged at startup. */
const DELETED_RETENTION_DAYS = 30;

const nowIso = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => DateTime.formatIso(DateTime.makeUnsafe(millis))),
);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const config = yield* ServerConfig.ServerConfig;
  const changes = yield* PubSub.sliding<void>(1);

  const failure = (message: string) => (cause: unknown) => new PageError({ message, cause });

  // A fork-local table, created here rather than as a numbered migration: the migrator
  // refuses a database whose recorded ids collide with upstream's next migration.
  yield* sql`
    CREATE TABLE IF NOT EXISTS pages (
      page_id TEXT PRIMARY KEY,
      parent_id TEXT,
      title TEXT NOT NULL,
      icon TEXT,
      markdown TEXT NOT NULL,
      position INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deletion_id TEXT
    )
  `.pipe(Effect.mapError(failure("Could not create the pages table.")));
  yield* sql`
    CREATE INDEX IF NOT EXISTS pages_live_by_parent
    ON pages (parent_id, position) WHERE deleted_at IS NULL
  `.pipe(Effect.mapError(failure("Could not index the pages table.")));
  yield* sql`
    DELETE FROM pages
    WHERE deleted_at IS NOT NULL
      AND deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${`-${DELETED_RETENTION_DAYS} days`})
  `.pipe(Effect.mapError(failure("Could not purge deleted pages.")));

  const notifyChanged = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

  const selectRows = <E>(query: Effect.Effect<ReadonlyArray<unknown>, E>, message: string) =>
    query.pipe(Effect.flatMap(decodeRows), Effect.mapError(failure(message)));

  const findRow = (id: PageId) =>
    selectRows(sql`SELECT * FROM pages WHERE page_id = ${id}`, "Could not read the page.").pipe(
      Effect.map((rows) => rows[0]),
    );

  const findLive = Effect.fn("PageService.findLive")(function* (id: PageId) {
    const row = yield* findRow(id);
    if (row === undefined || row.deleted_at !== null) return yield* new PageNotFoundError({ id });
    return row;
  });

  const list = selectRows(
    sql`
      SELECT * FROM pages WHERE deleted_at IS NULL
      ORDER BY parent_id IS NOT NULL, parent_id, position, created_at
    `,
    "Could not list pages.",
  ).pipe(
    NodeSqliteClient.readOnly,
    Effect.map((rows): PageListResult => ({ pages: rows.map(toSummary) })),
  );

  const nextPosition = (parentId: PageId | null) =>
    sql<{ readonly next: number }>`
      SELECT COALESCE(MAX(position) + 1, 0) AS next FROM pages
      WHERE deleted_at IS NULL AND parent_id IS ${parentId}
    `.pipe(
      Effect.map((rows) => rows[0]?.next ?? 0),
      Effect.mapError(failure("Could not order the page.")),
    );

  const liveDescendantIds = (id: PageId) =>
    sql<{ readonly page_id: string }>`
      WITH RECURSIVE tree(page_id) AS (
        SELECT page_id FROM pages WHERE page_id = ${id}
        UNION ALL
        SELECT pages.page_id FROM pages JOIN tree ON pages.parent_id = tree.page_id
        WHERE pages.deleted_at IS NULL
      )
      SELECT page_id FROM tree
    `.pipe(
      Effect.map((rows) => rows.map((row) => PageId.make(row.page_id))),
      Effect.mapError(failure("Could not read subpages.")),
    );

  const inTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    sql
      .withTransaction(effect)
      .pipe(
        Effect.mapError((error) =>
          SqlError.isSqlError(error)
            ? new PageError({ message: "The page change could not be saved.", cause: error })
            : error,
        ),
      );

  const create = Effect.fn("PageService.create")(function* (input: PageCreateInput) {
    const id =
      input.id ??
      PageId.make(
        `page:${yield* random.uuidV4().pipe(Effect.mapError(failure("Could not create a page id.")))}`,
      );
    const parentId = input.parentId ?? null;
    const now = yield* nowIso;
    const row = yield* inTransaction(
      Effect.gen(function* () {
        const existing = yield* findRow(id);
        // A retried create with the same client id returns the page it made.
        if (existing !== undefined && existing.deleted_at === null) return existing;
        if (existing !== undefined)
          return yield* new PageError({ message: "That page id belongs to a deleted page." });
        if (parentId !== null) yield* findLive(parentId);
        const position = yield* nextPosition(parentId);
        yield* sql`
          INSERT INTO pages (page_id, parent_id, title, icon, markdown, position, revision, created_at, updated_at)
          VALUES (${id}, ${parentId}, ${input.title ?? ""}, ${input.icon ?? null}, ${input.markdown ?? ""},
                  ${position}, 0, ${now}, ${now})
        `.pipe(Effect.mapError(failure("Could not create the page.")));
        return yield* findLive(id);
      }),
    );
    yield* notifyChanged;
    return toPage(row);
  });

  const update = Effect.fn("PageService.update")(function* (input: PageUpdateInput) {
    const now = yield* nowIso;
    const row = yield* inTransaction(
      Effect.gen(function* () {
        const current = yield* findLive(input.id);
        if (current.revision !== input.baseRevision)
          return yield* new PageConflictError({ page: toPage(current) });
        const title = input.title ?? current.title;
        const icon = input.icon === undefined ? current.icon : input.icon;
        const markdown = input.markdown ?? current.markdown;
        if (title === current.title && icon === current.icon && markdown === current.markdown)
          return current;
        yield* sql`
          UPDATE pages
          SET title = ${title}, icon = ${icon}, markdown = ${markdown},
              revision = revision + 1, updated_at = ${now}
          WHERE page_id = ${input.id}
        `.pipe(Effect.mapError(failure("Could not save the page.")));
        return yield* findLive(input.id);
      }),
    );
    if (row.revision !== input.baseRevision) yield* notifyChanged;
    return toPage(row);
  });

  const move = Effect.fn("PageService.move")(function* (input: PageMoveInput) {
    const now = yield* nowIso;
    const row = yield* inTransaction(
      Effect.gen(function* () {
        yield* findLive(input.id);
        if (input.parentId !== null) {
          yield* findLive(input.parentId);
          const subtree = yield* liveDescendantIds(input.id);
          if (subtree.includes(input.parentId))
            return yield* new PageError({ message: "A page cannot move inside itself." });
        }
        const siblings = yield* sql<{ readonly page_id: string }>`
          SELECT page_id FROM pages
          WHERE deleted_at IS NULL AND parent_id IS ${input.parentId} AND page_id != ${input.id}
          ORDER BY position, created_at
        `.pipe(Effect.mapError(failure("Could not read sibling pages.")));
        const order = siblings.map((sibling) => sibling.page_id);
        order.splice(Math.min(input.index, order.length), 0, input.id);
        for (const [position, pageId] of order.entries()) {
          yield* sql`UPDATE pages SET position = ${position} WHERE page_id = ${pageId}`.pipe(
            Effect.mapError(failure("Could not reorder pages.")),
          );
        }
        yield* sql`
          UPDATE pages SET parent_id = ${input.parentId}, updated_at = ${now}
          WHERE page_id = ${input.id}
        `.pipe(Effect.mapError(failure("Could not move the page.")));
        return yield* findLive(input.id);
      }),
    );
    yield* notifyChanged;
    return toPage(row);
  });

  const remove = Effect.fn("PageService.remove")(function* (id: PageId) {
    const now = yield* nowIso;
    const deletionId = yield* random
      .uuidV4()
      .pipe(Effect.mapError(failure("Could not delete the page.")));
    const ids = yield* inTransaction(
      Effect.gen(function* () {
        yield* findLive(id);
        const subtree = yield* liveDescendantIds(id);
        for (const pageId of subtree) {
          yield* sql`
            UPDATE pages SET deleted_at = ${now}, deletion_id = ${deletionId}
            WHERE page_id = ${pageId}
          `.pipe(Effect.mapError(failure("Could not delete the page.")));
        }
        return subtree;
      }),
    );
    yield* notifyChanged;
    return { ids };
  });

  const restore = Effect.fn("PageService.restore")(function* (id: PageId) {
    const row = yield* inTransaction(
      Effect.gen(function* () {
        const deleted = yield* findRow(id);
        if (deleted === undefined) return yield* new PageNotFoundError({ id });
        if (deleted.deleted_at === null) return deleted;
        // Subpages deleted with this page share its deletion id; ones deleted earlier stay deleted.
        yield* sql`
          WITH RECURSIVE tree(page_id) AS (
            SELECT page_id FROM pages WHERE page_id = ${id}
            UNION ALL
            SELECT pages.page_id FROM pages JOIN tree ON pages.parent_id = tree.page_id
            WHERE pages.deletion_id = ${deleted.deletion_id}
          )
          UPDATE pages SET deleted_at = NULL, deletion_id = NULL
          WHERE page_id IN (SELECT page_id FROM tree)
        `.pipe(Effect.mapError(failure("Could not restore the page.")));
        const parent = deleted.parent_id === null ? undefined : yield* findRow(deleted.parent_id);
        if (deleted.parent_id !== null && (parent === undefined || parent.deleted_at !== null)) {
          const position = yield* nextPosition(null);
          yield* sql`UPDATE pages SET parent_id = NULL, position = ${position} WHERE page_id = ${id}`.pipe(
            Effect.mapError(failure("Could not restore the page.")),
          );
        }
        return yield* findLive(id);
      }),
    );
    yield* notifyChanged;
    return toPage(row);
  });

  const generateEdit = Effect.fn("PageService.generateEdit")(function* (
    input: PageGenerateEditInput,
  ) {
    const page = yield* findLive(input.id).pipe(NodeSqliteClient.readOnly);
    return yield* textGeneration.generatePageEdit({
      cwd: config.stateDir,
      instruction: input.instruction,
      pageTitle: page.title,
      documentMarkdown: input.documentMarkdown,
      mode: input.mode,
      targetMarkdown: input.targetMarkdown,
      modelSelection: input.modelSelection,
    });
  });

  const subscribe = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the first read, so a change between them is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list)),
        );
      }),
    );

  return PageService.of({
    list,
    subscribe,
    get: Effect.fn("PageService.get")(function* (id) {
      return toPage(yield* findLive(id).pipe(NodeSqliteClient.readOnly));
    }),
    create,
    update,
    move,
    remove,
    restore,
    generateEdit,
  });
});

export const layer = Layer.effect(PageService, make);
