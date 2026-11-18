import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  PageId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const PAGE_TITLE_MAX_LENGTH = 300;
const PAGE_MARKDOWN_MAX_LENGTH = 1_000_000;
const PAGE_INSTRUCTION_MAX_LENGTH = 4_000;
/** Marks the cursor in an insert-mode page; the client places it, the model writes there. */
export const PAGE_EDIT_CURSOR_MARKER = "<<CURSOR>>";

const PageTitle = Schema.String.check(Schema.isMaxLength(PAGE_TITLE_MAX_LENGTH));
const PageIcon = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16)).annotate({
  description: "One emoji.",
});
const PageMarkdown = Schema.String.check(Schema.isMaxLength(PAGE_MARKDOWN_MAX_LENGTH)).annotate({
  description: "The page body as GitHub-flavored Markdown, without the title.",
});

export const PageSummary = Schema.Struct({
  id: PageId,
  parentId: Schema.NullOr(PageId),
  title: PageTitle,
  icon: Schema.NullOr(PageIcon),
  /** Order among siblings, from 0. */
  position: NonNegativeInt,
  /** Increments on every content change; updates must name the revision they edited. */
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PageSummary = typeof PageSummary.Type;

export const Page = Schema.Struct({
  ...PageSummary.fields,
  markdown: PageMarkdown,
});
export type Page = typeof Page.Type;

export const PageListInput = Schema.Struct({});
export type PageListInput = typeof PageListInput.Type;

export const PageListResult = Schema.Struct({
  pages: ForwardCompatibleArray(PageSummary),
});
export type PageListResult = typeof PageListResult.Type;

export const PageGetInput = Schema.Struct({ id: PageId });
export type PageGetInput = typeof PageGetInput.Type;

export const PageResult = Schema.Struct({ page: Page });
export type PageResult = typeof PageResult.Type;

export const PageCreateInput = Schema.Struct({
  /** Client-chosen id, so the client can open the page before the reply arrives. */
  id: Schema.optional(PageId),
  parentId: Schema.optional(Schema.NullOr(PageId)),
  title: Schema.optional(PageTitle),
  icon: Schema.optional(Schema.NullOr(PageIcon)),
  markdown: Schema.optional(PageMarkdown),
});
export type PageCreateInput = typeof PageCreateInput.Type;

export const PageUpdateInput = Schema.Struct({
  id: PageId,
  baseRevision: NonNegativeInt,
  title: Schema.optional(PageTitle),
  icon: Schema.optional(Schema.NullOr(PageIcon)),
  markdown: Schema.optional(PageMarkdown),
});
export type PageUpdateInput = typeof PageUpdateInput.Type;

export const PageMoveInput = Schema.Struct({
  id: PageId,
  parentId: Schema.NullOr(PageId),
  /** Position among the new siblings; past the end appends. */
  index: NonNegativeInt,
});
export type PageMoveInput = typeof PageMoveInput.Type;

export const PageDeleteInput = Schema.Struct({ id: PageId });
export type PageDeleteInput = typeof PageDeleteInput.Type;

export const PageDeleteResult = Schema.Struct({
  /** The page and every subpage removed with it. */
  ids: Schema.Array(PageId),
});
export type PageDeleteResult = typeof PageDeleteResult.Type;

export const PageRestoreInput = Schema.Struct({ id: PageId });
export type PageRestoreInput = typeof PageRestoreInput.Type;

export const PageEditMode = Schema.Literals(["replace", "insert"]);
export type PageEditMode = typeof PageEditMode.Type;

export const PageGenerateEditInput = Schema.Struct({
  id: PageId,
  instruction: TrimmedNonEmptyString.check(Schema.isMaxLength(PAGE_INSTRUCTION_MAX_LENGTH)),
  /** The page as the editor holds it, which may be ahead of the saved revision. */
  documentMarkdown: PageMarkdown,
  /** replace: rewrite `targetMarkdown`. insert: write new text at the cursor. */
  mode: PageEditMode,
  targetMarkdown: Schema.optional(PageMarkdown),
  modelSelection: ModelSelection,
});
export type PageGenerateEditInput = typeof PageGenerateEditInput.Type;

export const PageGenerateEditResult = Schema.Struct({
  markdown: Schema.String,
});
export type PageGenerateEditResult = typeof PageGenerateEditResult.Type;

export const PageAskInThreadInput = Schema.Struct({
  id: PageId,
  /** What to ask; the page itself travels as a context record on the message. */
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(PAGE_INSTRUCTION_MAX_LENGTH)),
  /** Omitted: the model a new chat starts with. */
  modelSelection: Schema.optional(ModelSelection),
});
export type PageAskInThreadInput = typeof PageAskInThreadInput.Type;

export const PageAskInThreadResult = Schema.Struct({ threadId: ThreadId });
export type PageAskInThreadResult = typeof PageAskInThreadResult.Type;

export class PageNotFoundError extends Schema.TaggedError<PageNotFoundError>()(
  "PageNotFoundError",
  { id: PageId },
) {
  override get message(): string {
    return "The page was not found.";
  }
}

export class PageConflictError extends Schema.TaggedError<PageConflictError>()(
  "PageConflictError",
  { page: Page },
) {
  override get message(): string {
    return "The page changed since it was read.";
  }
}

export class PageError extends Schema.TaggedError<PageError>()("PageError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const PageServiceError = Schema.Union([PageNotFoundError, PageConflictError, PageError]);
export type PageServiceError = typeof PageServiceError.Type;
