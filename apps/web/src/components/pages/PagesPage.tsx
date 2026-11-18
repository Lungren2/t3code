import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, PageId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FileTextIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { isElectron } from "~/env";
import { randomUUID } from "../../lib/utils";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PageEditor } from "./PageEditor";
import { PageTree } from "./PageTree";
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

export function PagesPage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {environmentId === null ? (
        <>
          <WorkspacePageHeader electron={isElectron} className="bg-background">
            <h1 className="truncate font-medium text-sm">Pages</h1>
          </WorkspacePageHeader>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Pages live on a T3 server</EmptyTitle>
              <EmptyDescription>
                Connect to your T3 Code server to read and write pages.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </>
      ) : (
        <EnvironmentPages environmentId={environmentId} />
      )}
    </SidebarInset>
  );
}

function EnvironmentPages({ environmentId }: { readonly environmentId: EnvironmentId }) {
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

  const creating = useRef(false);
  const createFromRouteFlag = useEffectEvent(() => {
    if (creating.current) return;
    creating.current = true;
    void addPage(null, true).finally(() => {
      creating.current = false;
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- "New page" arrives as a route flag from the palette or shortcut; it creates the page once.
  useEffect(() => {
    if (search.new === true && canEdit) createFromRouteFlag();
  }, [search.new, canEdit]);

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

  const selected = selectedId === null ? undefined : tree.byId.get(selectedId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkspacePageHeader electron={isElectron} className="bg-background">
        <WorkspaceBreadcrumb ariaLabel="Page location" className="overflow-hidden">
          <WorkspaceBreadcrumbItem current={ancestry.length === 0}>
            <h1 className="truncate">Pages</h1>
          </WorkspaceBreadcrumbItem>
          {ancestry.map((page, index) => (
            <span key={page.id} className="contents">
              <WorkspaceBreadcrumbSeparator />
              <WorkspaceBreadcrumbItem current={index === ancestry.length - 1}>
                <button type="button" className="truncate" onClick={() => open(page.id)}>
                  {pageLabel(page)}
                </button>
              </WorkspaceBreadcrumbItem>
            </span>
          ))}
        </WorkspaceBreadcrumb>
        <div className="min-w-0 flex-1" />
        {canEdit ? (
          <Button size="compact" variant="outline" onClick={() => void addPage(null)}>
            <PlusIcon />
            New page
          </Button>
        ) : null}
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Pages"
          className="hidden w-64 shrink-0 overflow-y-auto border-border border-r p-2 md:block"
        >
          {query.data === null ? (
            <div className="flex flex-col gap-2 p-1">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : (
            <PageTree
              tree={tree}
              selectedId={selectedId}
              ancestry={ancestry.map((page) => page.id)}
              canEdit={canEdit}
              actions={{
                open: (id) => open(id),
                addChild: (parentId) => void addPage(parentId),
                move,
                remove: (id) => void remove(id),
              }}
            />
          )}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {query.error !== null ? (
            <WorkspacePageContainer>
              <p className="text-muted-foreground text-sm">Pages could not load: {query.error}</p>
            </WorkspacePageContainer>
          ) : query.data !== null && selected === undefined ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>No pages yet</EmptyTitle>
                <EmptyDescription>
                  Write notes, plans and specs here. You and your agents can both edit them.
                </EmptyDescription>
              </EmptyHeader>
              {canEdit ? (
                <EmptyContent>
                  <Button onClick={() => void addPage(null)}>
                    <PlusIcon />
                    New page
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : selected !== undefined ? (
            <WorkspacePageContainer className="pb-64">
              <PageEditor
                key={selected.id}
                environmentId={environmentId}
                pageId={selected.id}
                liveRevision={selected.revision}
                canEdit={canEdit}
              />
            </WorkspacePageContainer>
          ) : null}
        </div>
      </div>
    </div>
  );
}
