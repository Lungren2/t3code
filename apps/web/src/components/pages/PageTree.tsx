import type { PageId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FileTextIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import {
  childrenOf,
  type PageMoveDirection,
  type PageTree as PageTreeModel,
  pageLabel,
  pageMove,
} from "./pages.logic";

const ExpandedPages = Schema.Array(Schema.String);

export interface PageTreeActions {
  readonly open: (id: PageId) => void;
  readonly addChild: (parentId: PageId | null) => void;
  readonly move: (id: PageId, direction: PageMoveDirection) => void;
  readonly remove: (id: PageId) => void;
}

export function PageTree({
  tree,
  selectedId,
  ancestry,
  canEdit,
  actions,
}: {
  readonly tree: PageTreeModel;
  readonly selectedId: PageId | null;
  /** Pages above the open one stay expanded, so it is always visible. */
  readonly ancestry: ReadonlyArray<PageId>;
  readonly canEdit: boolean;
  readonly actions: PageTreeActions;
}) {
  const [expanded, setExpanded] = useLocalStorage<ReadonlyArray<string>, ReadonlyArray<string>>(
    "t3code:pages:expanded",
    [],
    ExpandedPages,
  );
  const expandedSet = new Set([...expanded, ...ancestry]);
  const toggle = (id: PageId) =>
    setExpanded((current) =>
      expandedSet.has(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const renderLevel = (parentId: PageId | null, depth: number) =>
    childrenOf(tree, parentId).map((page) => {
      const children = childrenOf(tree, page.id);
      const isOpen = expandedSet.has(page.id);
      const selected = page.id === selectedId;
      return (
        <li
          key={page.id}
          role="treeitem"
          aria-selected={selected}
          aria-expanded={children.length > 0 ? isOpen : undefined}
        >
          <div
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            className={cn(
              "group flex h-8 items-center gap-0.5 rounded-md pr-1 text-sm",
              selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
            )}
          >
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={isOpen ? "Collapse" : "Expand"}
              disabled={children.length === 0}
              onClick={() => toggle(page.id)}
            >
              {children.length === 0 ? (
                <FileTextIcon />
              ) : (
                <ChevronRightIcon className={cn("transition-transform", isOpen && "rotate-90")} />
              )}
            </Button>
            <button
              type="button"
              onClick={() => actions.open(page.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 text-left"
            >
              {page.icon ? <span aria-hidden>{page.icon}</span> : null}
              <span className={cn("truncate", page.title.trim() === "" && "text-muted-foreground")}>
                {pageLabel(page)}
              </span>
            </button>
            {canEdit ? (
              <span className="flex items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={`Add a page inside ${pageLabel(page)}`}
                  onClick={() => {
                    if (!isOpen) toggle(page.id);
                    actions.addChild(page.id);
                  }}
                >
                  <PlusIcon />
                </Button>
                <PageRowMenu tree={tree} id={page.id} actions={actions} />
              </span>
            ) : null}
          </div>
          {children.length > 0 && isOpen ? (
            <ul role="group">{renderLevel(page.id, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });

  return (
    <ul role="tree" aria-label="Pages" className="flex flex-col gap-px">
      {renderLevel(null, 0)}
    </ul>
  );
}

const MOVES: ReadonlyArray<{
  readonly direction: PageMoveDirection;
  readonly label: string;
  readonly icon: React.ReactNode;
}> = [
  { direction: "up", label: "Move up", icon: <ArrowUpIcon /> },
  { direction: "down", label: "Move down", icon: <ArrowDownIcon /> },
  { direction: "indent", label: "Nest under the page above", icon: <IndentIncreaseIcon /> },
  { direction: "outdent", label: "Move out one level", icon: <IndentDecreaseIcon /> },
];

function PageRowMenu({
  tree,
  id,
  actions,
}: {
  readonly tree: PageTreeModel;
  readonly id: PageId;
  readonly actions: PageTreeActions;
}) {
  const page = tree.byId.get(id);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Actions for ${page ? pageLabel(page) : "page"}`}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        {MOVES.map((move) => (
          <MenuItem
            key={move.direction}
            disabled={pageMove(tree, id, move.direction) === null}
            onClick={() => actions.move(id, move.direction)}
          >
            {move.icon}
            {move.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem variant="destructive" onClick={() => actions.remove(id)}>
          <Trash2Icon />
          Delete
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
