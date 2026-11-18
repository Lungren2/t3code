import type { PageId, PageMoveInput, PageSummary } from "@t3tools/contracts";

const UNTITLED_PAGE = "Untitled";

export function pageLabel(page: Pick<PageSummary, "title">): string {
  return page.title.trim() || UNTITLED_PAGE;
}

export interface PageTree {
  readonly byId: ReadonlyMap<PageId, PageSummary>;
  /** Children in display order; the `null` key holds top-level pages. */
  readonly children: ReadonlyMap<PageId | null, ReadonlyArray<PageSummary>>;
}

export function buildPageTree(pages: ReadonlyArray<PageSummary>): PageTree {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const children = new Map<PageId | null, Array<PageSummary>>();
  for (const page of pages) {
    // A page whose parent is missing from the list shows at the top level rather than vanishing.
    const parentId = page.parentId !== null && byId.has(page.parentId) ? page.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(page);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }
  return { byId, children };
}

export function childrenOf(tree: PageTree, parentId: PageId | null): ReadonlyArray<PageSummary> {
  return tree.children.get(parentId) ?? [];
}

/** Root first, ending with the page itself. */
export function pageAncestry(tree: PageTree, id: PageId): ReadonlyArray<PageSummary> {
  const chain: Array<PageSummary> = [];
  const seen = new Set<PageId>();
  let current = tree.byId.get(id);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId === null ? undefined : tree.byId.get(current.parentId);
  }
  return chain;
}

function parentOf(tree: PageTree, page: PageSummary): PageId | null {
  return page.parentId !== null && tree.byId.has(page.parentId) ? page.parentId : null;
}

export type PageMoveDirection = "up" | "down" | "indent" | "outdent";

/**
 * Outline-style moves: up and down swap with a sibling, indent nests under the
 * sibling above, outdent places the page right after its parent.
 */
export function pageMove(
  tree: PageTree,
  id: PageId,
  direction: PageMoveDirection,
): PageMoveInput | null {
  const page = tree.byId.get(id);
  if (page === undefined) return null;
  const parentId = parentOf(tree, page);
  const siblings = childrenOf(tree, parentId);
  const index = siblings.findIndex((sibling) => sibling.id === id);
  switch (direction) {
    case "up":
      return index > 0 ? { id, parentId, index: index - 1 } : null;
    case "down":
      return index >= 0 && index < siblings.length - 1 ? { id, parentId, index: index + 1 } : null;
    case "indent": {
      const above = index > 0 ? siblings[index - 1] : undefined;
      return above === undefined
        ? null
        : { id, parentId: above.id, index: childrenOf(tree, above.id).length };
    }
    case "outdent": {
      if (parentId === null) return null;
      const parent = tree.byId.get(parentId);
      if (parent === undefined) return null;
      const grandparentId = parentOf(tree, parent);
      const parentIndex = childrenOf(tree, grandparentId).findIndex(
        (sibling) => sibling.id === parentId,
      );
      return { id, parentId: grandparentId, index: parentIndex + 1 };
    }
  }
}

/** The page to show after `id` and its subpages are deleted: a sibling, else the parent. */
export function pageAfterDelete(tree: PageTree, id: PageId): PageId | null {
  const page = tree.byId.get(id);
  if (page === undefined) return null;
  const parentId = parentOf(tree, page);
  const siblings = childrenOf(tree, parentId);
  const index = siblings.findIndex((sibling) => sibling.id === id);
  return siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? parentId;
}
