import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { type ModelSelection, PageId, ProviderInstanceId } from "@t3tools/contracts";
import type { PageEditGenerationInput } from "@t3tools/provider-core/server/textGeneration";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as PageService from "./PageService.ts";

const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("claude"),
  model: "claude-haiku",
};

const makeLayer = (edits: Ref.Ref<ReadonlyArray<PageEditGenerationInput>>) =>
  PageService.layer.pipe(
    Layer.provide(
      Layer.succeed(TextGeneration.TextGeneration, {
        generatePageEdit: (input: PageEditGenerationInput) =>
          Ref.update(edits, (all) => [...all, input]).pipe(Effect.as({ markdown: "Rewritten." })),
      } as unknown as TextGeneration.TextGeneration["Service"]),
    ),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-pages-" })),
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const withPages = <A, E>(
  program: (
    pages: PageService.PageService["Service"],
    edits: Ref.Ref<ReadonlyArray<PageEditGenerationInput>>,
  ) => Effect.Effect<A, E, PageService.PageService>,
) =>
  Effect.gen(function* () {
    const edits = yield* Ref.make<ReadonlyArray<PageEditGenerationInput>>([]);
    return yield* Effect.gen(function* () {
      return yield* program(yield* PageService.PageService, edits);
    }).pipe(Effect.provide(makeLayer(edits)));
  });

it.effect("creates nested pages and lists them in order", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const root = yield* pages.create({ title: "Roadmap", markdown: "# Q1" });
      const first = yield* pages.create({ parentId: root.id, title: "Search" });
      const second = yield* pages.create({ parentId: root.id, title: "Sync" });
      const read = yield* pages.get(root.id);
      assert.strictEqual(read.markdown, "# Q1");
      assert.strictEqual(read.revision, 0);
      const { pages: listed } = yield* pages.list;
      assert.deepStrictEqual(
        listed.map((page) => [page.title, page.parentId, page.position]),
        [
          ["Roadmap", null, 0],
          ["Search", root.id, 0],
          ["Sync", root.id, 1],
        ],
      );
      assert.notStrictEqual(first.id, second.id);
    }),
  ),
);

it.effect("replays a create with the same client id", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const id = PageId.make("page:client");
      yield* pages.create({ id, title: "Once" });
      const again = yield* pages.create({ id, title: "Twice" });
      assert.strictEqual(again.title, "Once");
      assert.strictEqual((yield* pages.list).pages.length, 1);
    }),
  ),
);

it.effect("rejects an update made against an older revision", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const page = yield* pages.create({ title: "Notes" });
      const saved = yield* pages.update({ id: page.id, baseRevision: 0, markdown: "One" });
      assert.strictEqual(saved.revision, 1);
      const unchanged = yield* pages.update({ id: page.id, baseRevision: 1, markdown: "One" });
      assert.strictEqual(unchanged.revision, 1);
      const stale = yield* pages
        .update({ id: page.id, baseRevision: 0, markdown: "Two" })
        .pipe(Effect.flip);
      assert.strictEqual(stale._tag, "PageConflictError");
      if (stale._tag === "PageConflictError") assert.strictEqual(stale.page.markdown, "One");
    }),
  ),
);

it.effect("deletes a page with its subpages and restores them together", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const root = yield* pages.create({ title: "Root" });
      const child = yield* pages.create({ parentId: root.id, title: "Child" });
      const earlier = yield* pages.create({ parentId: root.id, title: "Earlier" });
      yield* pages.remove(earlier.id);
      const removed = yield* pages.remove(root.id);
      assert.deepStrictEqual([...removed.ids].toSorted(), [root.id, child.id].toSorted());
      assert.strictEqual((yield* pages.list).pages.length, 0);
      const missing = yield* pages.get(child.id).pipe(Effect.flip);
      assert.strictEqual(missing._tag, "PageNotFoundError");

      yield* pages.restore(root.id);
      const titles = (yield* pages.list).pages.map((page) => page.title).toSorted();
      // A subpage deleted on its own stays deleted when its parent comes back.
      assert.deepStrictEqual(titles, ["Child", "Root"]);
    }),
  ),
);

it.effect("restores a subpage to the top level when its parent is gone", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const root = yield* pages.create({ title: "Root" });
      const child = yield* pages.create({ parentId: root.id, title: "Child" });
      yield* pages.remove(child.id);
      yield* pages.remove(root.id);
      const restored = yield* pages.restore(child.id);
      assert.strictEqual(restored.parentId, null);
    }),
  ),
);

it.effect("moves pages between parents and refuses cycles", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const a = yield* pages.create({ title: "A" });
      const b = yield* pages.create({ title: "B" });
      const c = yield* pages.create({ parentId: a.id, title: "C" });
      yield* pages.move({ id: b.id, parentId: null, index: 0 });
      assert.deepStrictEqual(
        (yield* pages.list).pages.filter((page) => page.parentId === null).map((p) => p.title),
        ["B", "A"],
      );
      const moved = yield* pages.move({ id: b.id, parentId: a.id, index: 0 });
      assert.strictEqual(moved.parentId, a.id);
      const children = (yield* pages.list).pages.filter((page) => page.parentId === a.id);
      assert.deepStrictEqual(
        children.map((page) => page.title),
        ["B", "C"],
      );
      const cycle = yield* pages.move({ id: a.id, parentId: c.id, index: 0 }).pipe(Effect.flip);
      assert.strictEqual(cycle._tag, "PageError");
    }),
  ),
);

it.effect("streams the page list again after each change", () =>
  withPages((pages) =>
    Effect.gen(function* () {
      const first = yield* Deferred.make<void>();
      const fiber = yield* pages.subscribe().pipe(
        Stream.tap(() => Deferred.succeed(first, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(first);
      yield* pages.create({ title: "Live" });
      const lists = yield* Fiber.join(fiber);
      assert.deepStrictEqual(
        [...lists].map((list) => list.pages.map((page) => page.title)),
        [[], ["Live"]],
      );
    }),
  ),
);

it.effect("generates an edit with the page title and the chosen model", () =>
  withPages((pages, edits) =>
    Effect.gen(function* () {
      const page = yield* pages.create({ title: "Launch plan", markdown: "We ship soon." });
      const result = yield* pages.generateEdit({
        id: page.id,
        instruction: "Make it sound confident",
        documentMarkdown: "We ship soon.",
        mode: "replace",
        targetMarkdown: "We ship soon.",
        modelSelection,
      });
      assert.strictEqual(result.markdown, "Rewritten.");
      const [call] = yield* Ref.get(edits);
      assert.strictEqual(call?.pageTitle, "Launch plan");
      assert.strictEqual(call?.targetMarkdown, "We ship soon.");
      assert.deepStrictEqual(call?.modelSelection, modelSelection);
    }),
  ),
);
