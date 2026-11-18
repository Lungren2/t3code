import { OrchestratorMcpFailure, type PageServiceError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as PageService from "../../../pages/PageService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { PagesToolkit } from "./tools.ts";

const pageFailure = (error: PageServiceError) => {
  switch (error._tag) {
    case "PageNotFoundError":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "The page was not found. t3_page_list shows the pages.",
      });
    case "PageConflictError":
      return new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `The page changed and is now at revision ${error.page.revision}. Read it again with t3_page_read and reapply your change.`,
      });
    case "PageError":
      return error.message === "A page cannot move inside itself."
        ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
        : unavailable();
  }
};

const action = "change this environment's pages";

export const layer = McpToolAccess.toLayer(
  PagesToolkit,
  Effect.gen(function* () {
    const pages = yield* PageService.PageService;
    return {
      t3_page_list: McpToolAccess.reads((input) =>
        pages.list.pipe(
          Effect.map((result) => ({
            pages: result.pages
              .filter((page) => input.parentId === undefined || page.parentId === input.parentId)
              .map(({ id, title, parentId }) => ({ id, title, parentId })),
          })),
          Effect.mapError(pageFailure),
        ),
      ),
      t3_page_read: McpToolAccess.reads((input) =>
        pages.get(input.id).pipe(
          Effect.map(({ id, title, parentId, revision, markdown }) => ({
            id,
            title,
            parentId,
            revision,
            markdown,
          })),
          Effect.mapError(pageFailure),
        ),
      ),
      t3_page_write: McpToolAccess.writes(
        (input) =>
          Effect.gen(function* () {
            if (input.id === undefined) {
              const created = yield* pages.create({
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
                ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
              });
              return { id: created.id, revision: created.revision };
            }
            if (input.baseRevision === undefined)
              return yield* new OrchestratorMcpFailure({
                code: "invalid_request",
                message: "Pass baseRevision from t3_page_read to edit a page.",
              });
            const updated = yield* pages.update({
              id: input.id,
              baseRevision: input.baseRevision,
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.markdown === undefined ? {} : { markdown: input.markdown }),
            });
            return { id: updated.id, revision: updated.revision };
          }).pipe(
            Effect.catchTags({
              PageNotFoundError: (error) => Effect.fail(pageFailure(error)),
              PageConflictError: (error) => Effect.fail(pageFailure(error)),
              PageError: (error) => Effect.fail(pageFailure(error)),
            }),
          ),
        { action },
      ),
    };
  }),
);
