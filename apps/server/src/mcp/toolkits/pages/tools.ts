import { NonNegativeInt, OrchestratorMcpFailure, PageId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as PageService from "../../../pages/PageService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  PageService.PageService,
];

const PageListTool = Tool.make("t3_page_list", {
  description:
    "List the user's pages (rich documents in T3 Code's Pages view): id, title, parentId for nesting.",
  parameters: Schema.Struct({
    parentId: Schema.optional(
      PageId.annotate({ description: "Only this page's direct subpages. Default: every page." }),
    ),
  }),
  success: Schema.Struct({
    pages: Schema.Array(
      Schema.Struct({ id: PageId, title: Schema.String, parentId: Schema.NullOr(PageId) }),
    ),
  }),
  failure: OrchestratorMcpFailure,
  dependencies,
})
  .annotate(Tool.Title, "List pages")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PageContent = Schema.Struct({
  id: PageId,
  title: Schema.String,
  parentId: Schema.NullOr(PageId),
  revision: NonNegativeInt,
  markdown: Schema.String,
});

const PageReadTool = Tool.make("t3_page_read", {
  description: "Read a page as Markdown, with the revision t3_page_write needs.",
  parameters: Schema.Struct({ id: PageId }),
  success: PageContent,
  failure: OrchestratorMcpFailure,
  dependencies,
})
  .annotate(Tool.Title, "Read page")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const PageWriteTool = Tool.make("t3_page_write", {
  description:
    "Create a page (omit id) or replace a page's title or Markdown body. The user sees the change live. To edit, pass id and the baseRevision from t3_page_read; a stale revision fails, so read again and reapply.",
  parameters: Schema.Struct({
    id: Schema.optional(PageId),
    baseRevision: Schema.optional(NonNegativeInt),
    title: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
    markdown: Schema.optional(
      Schema.String.check(Schema.isMaxLength(1_000_000)).annotate({
        description: "The whole body, without the title. GitHub-flavored Markdown.",
      }),
    ),
    parentId: Schema.optional(PageId.annotate({ description: "New pages only: nest under it." })),
  }),
  success: Schema.Struct({ id: PageId, revision: NonNegativeInt }),
  failure: OrchestratorMcpFailure,
  dependencies,
})
  .annotate(Tool.Title, "Write page")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const PagesToolkit = Toolkit.make(PageListTool, PageReadTool, PageWriteTool);
