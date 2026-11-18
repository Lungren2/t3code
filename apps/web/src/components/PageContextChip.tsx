import type { PageContextRecord } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";

import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Chip for a page sent as context; opens the page in Pages. */
export function PageContextChip(props: {
  record: Pick<PageContextRecord, "pageId" | "label">;
  copyMarkdown?: string;
}) {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="file"
            role="link"
            tabIndex={0}
            aria-label={`Page, ${props.record.label}`}
            data-markdown-copy={props.copyMarkdown}
            onClick={() => void navigate({ to: "/pages", search: { page: props.record.pageId } })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void navigate({ to: "/pages", search: { page: props.record.pageId } });
            }}
          >
            <FileTextIcon />
            <ContextChipLabel>{props.record.label}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">Open the page</TooltipPopup>
    </Tooltip>
  );
}
