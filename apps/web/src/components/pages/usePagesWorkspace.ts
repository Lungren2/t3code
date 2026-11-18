import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, PageId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { randomUUID } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import {
  buildPageTree,
  childrenOf,
  pageAfterDelete,
  pageAncestry,
  pageLabel,
  pageMove,
  type PageMoveDirection,
} from "./pages.logic";

export interface PagesSearch {
  readonly page?: string;
  /** Set by "New page" from the command palette or its shortcut; the page then creates one. */
  readonly new?: boolean;
}

/**
 * The page list, the open page and the page actions. The sidebar's tree and the editor view
 * both use it; they share one live subscription through the atom registry.
 */
export function usePagesWorkspace(environmentId: EnvironmentId) {
  const navigate = useNavigate();
  const search: PagesSearch = useSearch({ strict: false });
  const query = useEnvironmentQuery(serverEnvironment.pagesLive({ environmentId, input: {} }));
  const canEdit = useAtomValue(serverEnvironment.createPage.permissionAtom(environmentId));
  const createPage = useAtomCommand(serverEnvironment.createPage, {
    label: "Could not create a page",
  });
  const movePage = useAtomCommand(serverEnvironment.movePage, { label: "Could not move the page" });
  const deletePage = useAtomCommand(serverEnvironment.deletePage, {
    label: "Could not delete the page",
  });
  const restorePage = useAtomCommand(serverEnvironment.restorePage, {
    label: "Could not restore the page",
  });

  const tree = buildPageTree(query.data?.pages ?? []);
  const requested = search.page === undefined ? undefined : PageId.make(search.page);
  const selectedId =
    requested !== undefined && tree.byId.has(requested)
      ? requested
      : (childrenOf(tree, null)[0]?.id ?? null);
  const ancestry = selectedId === null ? [] : pageAncestry(tree, selectedId);

  const open = (id: PageId | null, replace = false) =>
    void navigate({ to: "/pages", search: id === null ? {} : { page: id }, replace });

  const addPage = async (parentId: PageId | null, replace = false) => {
    const id = PageId.make(`page:${randomUUID()}`);
    const result = await createPage({ environmentId, input: { id, parentId } });
    if (result._tag === "Success") open(result.value.page.id, replace);
  };

  const move = (id: PageId, direction: PageMoveDirection) => {
    const input = pageMove(tree, id, direction);
    if (input !== null) void movePage({ environmentId, input });
  };

  const remove = async (id: PageId) => {
    const page = tree.byId.get(id);
    const showsDeleted =
      selectedId !== null && pageAncestry(tree, selectedId).some((entry) => entry.id === id);
    const next = pageAfterDelete(tree, id);
    const result = await deletePage({ environmentId, input: { id } });
    if (result._tag !== "Success") return;
    if (showsDeleted) open(next, true);
    const removed = result.value.ids.length;
    toastManager.add({
      type: "success",
      title: `Deleted ${page ? `“${pageLabel(page)}”` : "the page"}`,
      ...(removed > 1
        ? { description: `With ${removed - 1} subpage${removed > 2 ? "s" : ""}.` }
        : {}),
      actionProps: {
        children: "Undo",
        onClick: () => {
          void restorePage({ environmentId, input: { id } }).then((restored) => {
            if (restored._tag === "Success") open(restored.value.page.id);
          });
        },
      },
    });
  };

  return {
    search,
    query,
    canEdit,
    tree,
    selectedId,
    selected: selectedId === null ? undefined : tree.byId.get(selectedId),
    ancestry,
    open,
    addPage,
    move,
    remove,
  };
}
