import type { EnvironmentId, PageEditMode, PageId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { PenLineIcon } from "lucide-react";
import { useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { PageModelPicker, usePagesModelSelection } from "./PageModelPicker";

export interface PageAskAiRequest {
  readonly mode: PageEditMode;
  readonly targetMarkdown: string | undefined;
  /** In insert mode this holds the cursor marker. */
  readonly documentMarkdown: string;
  /** Offset from the top of the editor column, just under the selection. */
  readonly top: number;
}

const QUICK_ACTIONS: Record<PageEditMode, ReadonlyArray<string>> = {
  replace: ["Improve writing", "Make shorter", "Fix spelling and grammar", "Make it a list"],
  insert: ["Continue writing", "Summarize this page", "List action items", "Draft an outline"],
};

type Phase =
  | { readonly kind: "prompt" }
  | { readonly kind: "writing" }
  | { readonly kind: "result"; readonly markdown: string }
  | { readonly kind: "error"; readonly message: string };

function failureMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    if (error._tag === "TextGenerationError" && "detail" in error)
      return `The model could not answer: ${String(error.detail)}`;
    if (error._tag === "PageNotFoundError") return "This page was deleted.";
  }
  return "The model could not answer. Try again, or pick another model.";
}

export function PageAskAi({
  environmentId,
  pageId,
  request,
  onAccept,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly pageId: PageId;
  readonly request: PageAskAiRequest;
  readonly onAccept: (markdown: string) => void;
  readonly onClose: () => void;
}) {
  const generate = useAtomCommand(serverEnvironment.generatePageEdit, { reportFailure: false });
  const { selection } = usePagesModelSelection(environmentId);
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "prompt" });
  const runId = useRef(0);
  const lastInstruction = useRef("");

  const run = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    lastInstruction.current = trimmed;
    const id = ++runId.current;
    setPhase({ kind: "writing" });
    const result = await generate({
      environmentId,
      input: {
        id: pageId,
        instruction: trimmed,
        documentMarkdown: request.documentMarkdown,
        mode: request.mode,
        ...(request.targetMarkdown === undefined ? {} : { targetMarkdown: request.targetMarkdown }),
        modelSelection: selection,
      },
    });
    // A newer run, or closing the panel, makes this answer stale.
    if (id !== runId.current) return;
    if (result._tag === "Success") {
      setPhase(
        result.value.markdown.trim() === ""
          ? { kind: "error", message: "The model returned nothing. Try rewording." }
          : { kind: "result", markdown: result.value.markdown },
      );
    } else if (!isAtomCommandInterrupted(result)) {
      setPhase({ kind: "error", message: failureMessage(squashAtomCommandFailure(result)) });
    }
  };

  const close = () => {
    runId.current += 1;
    onClose();
  };

  return (
    <div
      style={{ top: request.top }}
      className="absolute inset-x-0 z-30 flex flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      {phase.kind === "result" ? (
        <>
          <div className="text-muted-foreground text-xs">
            {request.mode === "replace" ? "Replace the selection with:" : "Insert at the cursor:"}
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2">
            <ChatMarkdown text={phase.markdown} cwd={undefined} environmentId={environmentId} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="compact" onClick={close}>
              Discard
            </Button>
            <Button
              variant="outline"
              size="compact"
              onClick={() => void run(lastInstruction.current)}
            >
              Try again
            </Button>
            <Button size="compact" autoFocus onClick={() => onAccept(phase.markdown)}>
              {request.mode === "replace" ? "Replace" : "Insert"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <PenLineIcon aria-hidden className="mt-2 size-4 shrink-0 text-muted-foreground" />
            <Textarea
              autoFocus
              aria-label="What should the model do?"
              placeholder={
                request.mode === "replace"
                  ? "Tell the model how to change the selection…"
                  : "Tell the model what to write…"
              }
              value={instruction}
              disabled={phase.kind === "writing"}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void run(instruction);
                }
              }}
            />
          </div>
          {phase.kind === "error" ? (
            <p role="alert" className="text-destructive-foreground text-sm">
              {phase.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {phase.kind === "writing" ? (
              <span className="text-muted-foreground text-sm">Writing…</span>
            ) : (
              QUICK_ACTIONS[request.mode].map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  size="compact"
                  onClick={() => {
                    setInstruction(action);
                    void run(action);
                  }}
                >
                  {action}
                </Button>
              ))
            )}
            <div className="min-w-0 flex-1" />
            <PageModelPicker environmentId={environmentId} selection={selection} />
            <Button variant="ghost" size="compact" onClick={close}>
              {phase.kind === "writing" ? "Stop" : "Cancel"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
