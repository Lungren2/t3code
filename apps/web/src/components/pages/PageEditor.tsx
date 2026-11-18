import {
  type EnvironmentId,
  PAGE_EDIT_CURSOR_MARKER,
  PAGE_TITLE_MAX_LENGTH,
  type Page,
  type PageId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { resolveDiffThemeName } from "~/lib/diffRendering";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { composerCodeBlockHighlight } from "../composerCodeBlockHighlight";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { PageAskAi, type PageAskAiRequest } from "./PageAskAi";
import { PageAskInThread } from "./PageAskInThread";
import { PageSelectionToolbar } from "./PageSelectionToolbar";
import { PageSlashMenu } from "./PageSlashMenu";
import { SlashMenuStore, pageSlashCommand } from "./pageSlashCommands";

const SAVE_DELAY_MS = 600;

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly page: Page }
  | { readonly status: "missing" };

function errorTag(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "_tag" in error
    ? String(error._tag)
    : undefined;
}

export function PageEditor({
  environmentId,
  pageId,
  liveRevision,
  canEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly pageId: PageId;
  readonly liveRevision: number | undefined;
  readonly canEdit: boolean;
}) {
  const getPage = useAtomCommand(serverEnvironment.getPage, { reportFailure: false });
  const [load, setLoad] = useState<LoadState>({ status: "loading" });

  const loadPage = useEffectEvent((isCancelled: () => boolean) => {
    void getPage({ environmentId, input: { id: pageId } }).then((result) => {
      if (isCancelled()) return;
      setLoad(
        result._tag === "Success"
          ? { status: "loaded", page: result.value.page }
          : { status: "missing" },
      );
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the page from the server once it opens; the parent remounts this per page.
  useEffect(() => {
    let cancelled = false;
    loadPage(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.status === "loading") {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (load.status === "missing") {
    return <p className="pt-8 text-muted-foreground text-sm">This page was deleted.</p>;
  }
  return (
    <LoadedPageEditor
      environmentId={environmentId}
      page={load.page}
      liveRevision={liveRevision}
      canEdit={canEdit}
    />
  );
}

interface SyncState {
  baseRevision: number;
  savedTitle: string;
  savedMarkdown: string;
  saving: boolean;
  queued: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function selectionMarkdown(editor: Editor, from: number, to: number): string {
  const slice = editor.state.doc.slice(from, to);
  return editor.markdown?.serialize({ type: "doc", content: slice.content.toJSON() }) ?? "";
}

function markdownWithCursor(editor: Editor, at: number): string {
  const doc = editor.state.tr.insertText(PAGE_EDIT_CURSOR_MARKER, at).doc;
  return editor.markdown?.serialize(doc.toJSON()) ?? editor.getMarkdown();
}

function LoadedPageEditor({
  environmentId,
  page,
  liveRevision,
  canEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly page: Page;
  readonly liveRevision: number | undefined;
  readonly canEdit: boolean;
}) {
  const updatePage = useAtomCommand(serverEnvironment.updatePage, { reportFailure: false });
  const getPage = useAtomCommand(serverEnvironment.getPage, { reportFailure: false });
  const [title, setTitle] = useState(page.title);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [conflict, setConflict] = useState<Page | null>(null);
  const [askAi, setAskAi] = useState<PageAskAiRequest | null>(null);
  const [slashMenu] = useState(() => new SlashMenuStore());
  const sync = useRef<SyncState>({
    baseRevision: page.revision,
    savedTitle: page.title,
    savedMarkdown: page.markdown,
    saving: false,
    queued: false,
    timer: null,
  });
  const titleRef = useRef(page.title);
  // Tiptap keeps the callbacks it was created with, so everything they reach goes through refs.
  const editorRef = useRef<Editor | null>(null);
  const conflictRef = useRef<Page | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const askAiRange = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? "Heading" : "Write, or press / for blocks",
      }),
      Markdown,
      composerCodeBlockHighlight({
        resolveTheme: () =>
          resolveDiffThemeName(
            document.documentElement.classList.contains("dark") ? "dark" : "light",
          ),
      }),
      pageSlashCommand(slashMenu),
    ],
    content: page.markdown,
    contentType: "markdown",
    editable: canEdit,
    editorProps: {
      attributes: { class: "page-editor-content chat-markdown", "aria-label": "Page body" },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
          slashMenu.requestAskAi();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: created }) => {
      // Compare later saves with the editor's own serialization, so opening a page never rewrites it.
      sync.current.savedMarkdown = created.getMarkdown();
    },
    onUpdate: () => scheduleSave(),
    onTransaction: ({ transaction }) => {
      const range = askAiRange.current;
      if (range === null || !transaction.docChanged) return;
      askAiRange.current = {
        from: transaction.mapping.map(range.from),
        to: transaction.mapping.map(range.to, -1),
      };
    },
  });

  const showConflict = (next: Page | null) => {
    conflictRef.current = next;
    setConflict(next);
  };

  const isDirty = () => {
    const current = editorRef.current;
    return (
      current !== null &&
      (current.getMarkdown() !== sync.current.savedMarkdown ||
        titleRef.current !== sync.current.savedTitle)
    );
  };

  const applyServerPage = (next: Page) => {
    const editor = editorRef.current;
    if (editor === null) return;
    editor.commands.setContent(next.markdown, { contentType: "markdown", emitUpdate: false });
    setTitle(next.title);
    titleRef.current = next.title;
    sync.current.baseRevision = next.revision;
    sync.current.savedTitle = next.title;
    sync.current.savedMarkdown = editor.getMarkdown();
    showConflict(null);
    setStatus("saved");
  };

  const save = async (): Promise<void> => {
    const state = sync.current;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const editor = editorRef.current;
    if (editor === null || conflictRef.current !== null) return;
    if (state.saving) {
      state.queued = true;
      return;
    }
    const markdown = editor.getMarkdown();
    const nextTitle = titleRef.current;
    if (markdown === state.savedMarkdown && nextTitle === state.savedTitle) {
      setStatus("saved");
      return;
    }
    state.saving = true;
    setStatus("saving");
    const result = await updatePage({
      environmentId,
      input: { id: page.id, baseRevision: state.baseRevision, title: nextTitle, markdown },
    });
    state.saving = false;
    if (result._tag === "Success") {
      state.baseRevision = result.value.page.revision;
      state.savedMarkdown = markdown;
      state.savedTitle = nextTitle;
      if (state.queued || isDirty()) {
        state.queued = false;
        await save();
      } else {
        setStatus("saved");
      }
      return;
    }
    state.queued = false;
    const error = squashAtomCommandFailure(result);
    if (errorTag(error) === "PageConflictError") {
      showConflict((error as { readonly page: Page }).page);
      setStatus("unsaved");
      return;
    }
    setStatus("error");
    toastManager.add({
      type: "error",
      title: "Could not save the page",
      description:
        errorTag(error) === "PageNotFoundError"
          ? "It was deleted."
          : "Your changes are still here. Edit again to retry.",
    });
  };

  const scheduleSave = () => {
    const state = sync.current;
    setStatus("unsaved");
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const pullRemoteEdits = useEffectEvent((revision: number, isCancelled: () => boolean) => {
    if (revision <= sync.current.baseRevision || sync.current.saving || isDirty()) return;
    void getPage({ environmentId, input: { id: page.id } }).then((result) => {
      if (isCancelled() || result._tag !== "Success" || isDirty() || sync.current.saving) return;
      if (result.value.page.revision > sync.current.baseRevision)
        applyServerPage(result.value.page);
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pulls in edits made elsewhere (agents, other devices) when this editor has none of its own.
  useEffect(() => {
    if (liveRevision === undefined) return;
    let cancelled = false;
    pullRemoteEdits(liveRevision, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [liveRevision]);

  const flushPendingSave = useEffectEvent(() => {
    if (sync.current.timer === null) return;
    clearTimeout(sync.current.timer);
    sync.current.timer = null;
    void save();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves unsaved edits when the page closes instead of dropping them.
  useEffect(() => () => flushPendingSave(), []);

  function openAskAi() {
    if (editor === null) return;
    const { from, to, empty } = editor.state.selection;
    const container = containerRef.current?.getBoundingClientRect();
    const caret = editor.view.coordsAtPos(to);
    askAiRange.current = { from, to };
    setAskAi({
      mode: empty ? "insert" : "replace",
      targetMarkdown: empty ? undefined : selectionMarkdown(editor, from, to),
      documentMarkdown: empty ? markdownWithCursor(editor, from) : editor.getMarkdown(),
      top: caret.bottom - (container?.top ?? 0) + 8,
    });
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Tiptap's callbacks are fixed at creation; they read the live editor and Ask AI opener from here.
  useLayoutEffect(() => {
    editorRef.current = editor;
    slashMenu.setAskAiHandler(openAskAi);
  });

  const acceptSuggestion = (markdown: string) => {
    const range = askAiRange.current;
    setAskAi(null);
    askAiRange.current = null;
    if (editor === null || range === null) return;
    const size = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: Math.min(range.from, size), to: Math.min(range.to, size) },
        markdown,
        { contentType: "markdown" },
      )
      .run();
  };

  const closeAskAi = () => {
    setAskAi(null);
    askAiRange.current = null;
    editor?.commands.focus();
  };

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2">
      {conflict !== null ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">This page changed somewhere else while you edited.</span>
          <Button variant="ghost" size="compact" onClick={() => applyServerPage(conflict)}>
            Load theirs
          </Button>
          <Button
            variant="outline"
            size="compact"
            onClick={() => {
              sync.current.baseRevision = conflict.revision;
              showConflict(null);
              void save();
            }}
          >
            Keep mine
          </Button>
        </div>
      ) : null}
      <textarea
        aria-label="Page title"
        readOnly={!canEdit}
        rows={1}
        maxLength={PAGE_TITLE_MAX_LENGTH}
        placeholder="Untitled"
        value={title}
        onChange={(event) => {
          const next = event.target.value.replace(/\n/g, " ");
          setTitle(next);
          titleRef.current = next;
          scheduleSave();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            editor?.commands.focus("start");
          }
        }}
        className="w-full resize-none bg-transparent font-semibold text-3xl leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 [field-sizing:content]"
      />
      <div className="flex min-h-7 items-center gap-2">
        <SaveStatus status={status} />
        <div className="min-w-0 flex-1" />
        {canEdit ? (
          <PageAskInThread environmentId={environmentId} pageId={page.id} flushPage={save} />
        ) : null}
      </div>
      <EditorContent editor={editor} className="page-editor min-h-[50vh]" />
      {editor !== null && canEdit && askAi === null ? (
        <>
          <PageSlashMenuHost store={slashMenu} />
          <PageSelectionToolbar editor={editor} onAskAi={() => slashMenu.requestAskAi()} />
        </>
      ) : null}
      {askAi !== null ? (
        <PageAskAi
          environmentId={environmentId}
          pageId={page.id}
          request={askAi}
          onAccept={acceptSuggestion}
          onClose={closeAskAi}
        />
      ) : null}
    </div>
  );
}

function PageSlashMenuHost({ store }: { readonly store: SlashMenuStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <PageSlashMenu state={state} onChoose={(index) => store.choose(index)} />;
}

function SaveStatus({ status }: { readonly status: "saved" | "saving" | "unsaved" | "error" }) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "unsaved"
        ? "Edited"
        : status === "error"
          ? "Not saved"
          : "Saved";
  return (
    <span aria-live="polite" className="text-muted-foreground text-xs">
      {label}
    </span>
  );
}
