import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";

export type PageBlockId =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "divider"
  | "table"
  | "askAi";

export interface PageBlock {
  readonly id: PageBlockId;
  readonly label: string;
  readonly hint: string;
  readonly keywords: ReadonlyArray<string>;
}

const PAGE_BLOCKS: ReadonlyArray<PageBlock> = [
  { id: "askAi", label: "Ask AI", hint: "Write or edit with a model", keywords: ["ai", "write"] },
  { id: "text", label: "Text", hint: "Plain paragraph", keywords: ["paragraph", "p"] },
  { id: "heading1", label: "Heading 1", hint: "#", keywords: ["h1", "title"] },
  { id: "heading2", label: "Heading 2", hint: "##", keywords: ["h2", "subtitle"] },
  { id: "heading3", label: "Heading 3", hint: "###", keywords: ["h3"] },
  { id: "bulletList", label: "Bulleted list", hint: "-", keywords: ["ul", "bullet", "list"] },
  { id: "orderedList", label: "Numbered list", hint: "1.", keywords: ["ol", "number", "list"] },
  { id: "taskList", label: "To-do list", hint: "[ ]", keywords: ["todo", "task", "check"] },
  { id: "blockquote", label: "Quote", hint: ">", keywords: ["quote", "blockquote"] },
  { id: "codeBlock", label: "Code", hint: "```", keywords: ["code", "snippet"] },
  { id: "divider", label: "Divider", hint: "---", keywords: ["hr", "rule", "line"] },
  { id: "table", label: "Table", hint: "3 × 3", keywords: ["grid", "columns"] },
];

function filterPageBlocks(query: string): ReadonlyArray<PageBlock> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return PAGE_BLOCKS;
  // Match the start of a word, so "t" finds Text, To-do and Table but not Heading.
  return PAGE_BLOCKS.filter(
    (block) =>
      block.label
        .toLowerCase()
        .split(/[\s-]+/)
        .some((word) => word.startsWith(needle)) ||
      block.label.toLowerCase().startsWith(needle) ||
      block.keywords.some((keyword) => keyword.startsWith(needle)),
  );
}

/** Turns the current block into `id`; Ask AI is handled by the editor, which owns its prompt. */
function applyPageBlock(editor: Editor, range: Range, id: PageBlockId): void {
  const chain = editor.chain().focus().deleteRange(range);
  switch (id) {
    case "text":
      chain.setParagraph().run();
      return;
    case "heading1":
    case "heading2":
    case "heading3":
      chain.setHeading({ level: id === "heading1" ? 1 : id === "heading2" ? 2 : 3 }).run();
      return;
    case "bulletList":
      chain.toggleBulletList().run();
      return;
    case "orderedList":
      chain.toggleOrderedList().run();
      return;
    case "taskList":
      chain.toggleTaskList().run();
      return;
    case "blockquote":
      chain.toggleBlockquote().run();
      return;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      return;
    case "divider":
      chain.setHorizontalRule().run();
      return;
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    case "askAi":
      chain.run();
      return;
  }
}

export interface SlashMenuState {
  readonly open: boolean;
  readonly items: ReadonlyArray<PageBlock>;
  readonly selectedIndex: number;
  readonly rect: DOMRect | null;
}

const CLOSED: SlashMenuState = { open: false, items: [], selectedIndex: 0, rect: null };

/** Bridges the suggestion plugin's callbacks to React through useSyncExternalStore. */
export class SlashMenuStore {
  #state: SlashMenuState = CLOSED;
  #listeners = new Set<() => void>();
  #command: ((block: PageBlock) => void) | null = null;
  #askAi: () => void = () => undefined;

  /** The editor registers how to open Ask AI; the slash item and Mod+J ask through here. */
  setAskAiHandler(handler: () => void) {
    this.#askAi = handler;
  }

  requestAskAi() {
    this.#askAi();
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = () => this.#state;

  #set(next: SlashMenuState) {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }

  show(props: SuggestionProps<PageBlock, PageBlock>) {
    this.#command = props.command;
    const selectedIndex = Math.min(this.#state.selectedIndex, Math.max(props.items.length - 1, 0));
    this.#set({
      open: true,
      items: props.items,
      selectedIndex: this.#state.open ? selectedIndex : 0,
      rect: props.clientRect?.() ?? null,
    });
  }

  hide() {
    this.#command = null;
    this.#set(CLOSED);
  }

  choose(index: number) {
    const block = this.#state.items[index];
    if (block !== undefined) this.#command?.(block);
  }

  keyDown({ event }: SuggestionKeyDownProps): boolean {
    const { open, items, selectedIndex } = this.#state;
    if (!open || items.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.#set({
        ...this.#state,
        selectedIndex: (selectedIndex + step + items.length) % items.length,
      });
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      this.choose(selectedIndex);
      return true;
    }
    if (event.key === "Escape") {
      this.hide();
      return true;
    }
    return false;
  }
}

export function pageSlashCommand(store: SlashMenuStore) {
  return Extension.create({
    name: "pageSlashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<PageBlock, PageBlock>({
          editor: this.editor,
          pluginKey: new PluginKey("pageSlashCommand"),
          char: "/",
          allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
          items: ({ query }) => [...filterPageBlocks(query)],
          command: ({ editor, range, props }) => {
            applyPageBlock(editor, range, props.id);
            if (props.id === "askAi") store.requestAskAi();
          },
          render: () => ({
            onStart: (props) => store.show(props),
            onUpdate: (props) => store.show(props),
            onExit: () => store.hide(),
            onKeyDown: (props) => store.keyDown(props),
          }),
        }),
      ];
    },
  });
}
