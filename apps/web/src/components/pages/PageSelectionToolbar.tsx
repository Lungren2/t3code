import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  PenLineIcon,
  StrikethroughIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function PageSelectionToolbar({
  editor,
  onAskAi,
}: {
  readonly editor: Editor;
  readonly onAskAi: () => void;
}) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      inCode: current.isActive("codeBlock"),
    }),
  });

  const applyLink = (href: string) => {
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href.trim() === "") chain.unsetLink().run();
    else chain.setLink({ href: href.trim() }).run();
    setLinkDraft(null);
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: current, state }) =>
        current.isEditable && !state.selection.empty && !current.isActive("codeBlock")
      }
      className="z-40 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      {linkDraft !== null ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink(linkDraft);
          }}
        >
          <Input
            autoFocus
            size="sm"
            aria-label="Link address"
            placeholder="https://"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLinkDraft(null);
                editor.commands.focus();
              }
            }}
          />
          <Button type="submit" size="compact" variant="ghost">
            {linkDraft.trim() === "" ? "Remove" : "Apply"}
          </Button>
        </form>
      ) : (
        <>
          <Button
            size="compact"
            variant="ghost"
            onClick={onAskAi}
            aria-label="Ask AI about the selection"
          >
            <PenLineIcon />
            Ask AI
          </Button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          <MarkButton
            label="Bold"
            pressed={active.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <BoldIcon />
          </MarkButton>
          <MarkButton
            label="Italic"
            pressed={active.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <ItalicIcon />
          </MarkButton>
          <MarkButton
            label="Strikethrough"
            pressed={active.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <StrikethroughIcon />
          </MarkButton>
          <MarkButton
            label="Code"
            pressed={active.code}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <CodeIcon />
          </MarkButton>
          <MarkButton
            label="Link"
            pressed={active.link}
            onClick={() => setLinkDraft(String(editor.getAttributes("link").href ?? ""))}
          >
            <LinkIcon />
          </MarkButton>
        </>
      )}
    </BubbleMenu>
  );
}

function MarkButton({
  label,
  pressed,
  onClick,
  children,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      aria-pressed={pressed}
      data-pressed={pressed ? "" : undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
