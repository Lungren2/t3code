import { PageId, type PageSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildPageTree, pageAfterDelete, pageAncestry, pageMove } from "./pages.logic";

const page = (id: string, parentId: string | null, position: number): PageSummary => ({
  id: PageId.make(id),
  parentId: parentId === null ? null : PageId.make(parentId),
  title: id,
  icon: null,
  position,
  revision: 0,
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
});

// a
// ├─ a1
// └─ a2
// b
const tree = buildPageTree([
  page("b", null, 1),
  page("a2", "a", 1),
  page("a", null, 0),
  page("a1", "a", 0),
]);
const id = (value: string) => PageId.make(value);

describe("buildPageTree", () => {
  it("orders siblings and keeps orphans at the top level", () => {
    const withOrphan = buildPageTree([page("x", "gone", 0), page("a", null, 1)]);
    expect(withOrphan.children.get(null)?.map((entry) => entry.id)).toEqual(["x", "a"]);
    expect(tree.children.get(id("a"))?.map((entry) => entry.id)).toEqual(["a1", "a2"]);
  });

  it("lists ancestry from the root", () => {
    expect(pageAncestry(tree, id("a2")).map((entry) => entry.id)).toEqual(["a", "a2"]);
  });
});

describe("pageMove", () => {
  it.each([
    ["a1", "up", null],
    ["a1", "down", { id: "a1", parentId: "a", index: 1 }],
    ["a2", "up", { id: "a2", parentId: "a", index: 0 }],
    ["a2", "indent", { id: "a2", parentId: "a1", index: 0 }],
    ["a1", "indent", null],
    ["a2", "outdent", { id: "a2", parentId: null, index: 1 }],
    ["b", "outdent", null],
    ["b", "indent", { id: "b", parentId: "a", index: 2 }],
  ] as const)("%s %s", (pageId, direction, expected) => {
    expect(pageMove(tree, id(pageId), direction)).toEqual(expected);
  });
});

describe("pageAfterDelete", () => {
  it("prefers the next sibling, then the previous one, then the parent", () => {
    expect(pageAfterDelete(tree, id("a1"))).toBe("a2");
    expect(pageAfterDelete(tree, id("a2"))).toBe("a1");
    expect(pageAfterDelete(buildPageTree([page("a", null, 0), page("c", "a", 0)]), id("c"))).toBe(
      "a",
    );
  });
});
