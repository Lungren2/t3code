import { createPortal } from "react-dom";

import { cn } from "../../lib/utils";
import type { SlashMenuState } from "./pageSlashCommands";

const MENU_WIDTH = 260;

export function PageSlashMenu({
  state,
  onChoose,
}: {
  readonly state: SlashMenuState;
  readonly onChoose: (index: number) => void;
}) {
  if (!state.open || state.rect === null) return null;
  const left = Math.min(state.rect.left, window.innerWidth - MENU_WIDTH - 12);
  const below = state.rect.bottom + 6;
  const fitsBelow = below + 320 < window.innerHeight;
  return createPortal(
    <div
      role="listbox"
      aria-label="Blocks"
      style={{
        left,
        width: MENU_WIDTH,
        ...(fitsBelow ? { top: below } : { bottom: window.innerHeight - state.rect.top + 6 }),
      }}
      className="fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {state.items.length === 0 ? (
        <div className="px-2 py-1.5 text-muted-foreground text-sm">No matching block</div>
      ) : (
        state.items.map((block, index) => (
          <div
            key={block.id}
            role="option"
            aria-selected={index === state.selectedIndex}
            // Keep the editor's selection: a mousedown would blur it before the click runs.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(index)}
            className={cn(
              "flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm",
              index === state.selectedIndex && "bg-accent text-accent-foreground",
            )}
          >
            <span className="truncate">{block.label}</span>
            <span className="shrink-0 font-mono text-muted-foreground text-xs">{block.hint}</span>
          </div>
        ))
      )}
    </div>,
    document.body,
  );
}
