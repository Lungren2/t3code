import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { FileTextIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { isElectron } from "~/env";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
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
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PageEditor } from "./PageEditor";
import { pageLabel } from "./pages.logic";
import { usePagesWorkspace } from "./usePagesWorkspace";

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
  const pages = usePagesWorkspace(environmentId);
  const { search, query, canEdit, selected, ancestry, open, addPage } = pages;

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
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
  );
}
