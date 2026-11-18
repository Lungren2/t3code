import type { EnvironmentId, PageId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

/** Starts an agent thread with the page attached, on the model a new chat starts with. */
export function PageAskInThread({
  environmentId,
  pageId,
  flushPage,
}: {
  readonly environmentId: EnvironmentId;
  readonly pageId: PageId;
  /** Saves pending edits first, so the agent reads what is on screen. */
  readonly flushPage: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const ask = useAtomCommand(serverEnvironment.askPageInThread, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);

  const start = async () => {
    const text = prompt.trim();
    if (text === "" || starting) return;
    setStarting(true);
    await flushPage();
    const result = await ask({ environmentId, input: { id: pageId, prompt: text } });
    setStarting(false);
    if (result._tag === "Success") {
      setOpen(false);
      setPrompt("");
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
      return;
    }
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Could not start the thread",
      description:
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : "Try again.",
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button size="compact" variant="outline">
            <MessagesSquareIcon />
            Ask in a thread
          </Button>
        }
      />
      <PopoverPopup align="end" className="w-96">
        <PopoverTitle>Ask an agent about this page</PopoverTitle>
        <p className="text-muted-foreground text-sm">
          Starts a thread with this page attached. The agent can also edit the page.
        </p>
        <Textarea
          autoFocus
          aria-label="What should the agent do?"
          placeholder="Review this plan and fill in the open questions…"
          value={prompt}
          disabled={starting}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void start();
            }
          }}
        />
        <div className="flex justify-end">
          <Button
            size="compact"
            disabled={prompt.trim() === "" || starting}
            onClick={() => void start()}
          >
            {starting ? "Starting…" : "Start thread"}
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
