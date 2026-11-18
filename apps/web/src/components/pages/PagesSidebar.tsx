import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";

import { isElectron } from "~/env";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { SidebarContent, SidebarGroup } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { PageTree } from "./PageTree";
import { usePagesWorkspace } from "./usePagesWorkspace";

/** What the app sidebar shows while Pages is open: the page tree instead of threads. */
export function PagesSidebar() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent className="min-h-full">
        {environmentId === null ? null : <PagesSidebarTree environmentId={environmentId} />}
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function PagesSidebarTree({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const pages = usePagesWorkspace(environmentId);
  return (
    <SidebarGroup className="flex-1">
      <div className="flex h-8 items-center justify-between pl-2">
        <h2 className="font-medium text-muted-foreground text-xs">Pages</h2>
        {pages.canEdit ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="New page"
            onClick={() => void pages.addPage(null)}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      {pages.query.data === null ? (
        <div className="flex flex-col gap-2 p-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : (
        <PageTree
          tree={pages.tree}
          selectedId={pages.selectedId}
          ancestry={pages.ancestry.map((page) => page.id)}
          canEdit={pages.canEdit}
          actions={{
            open: (id) => pages.open(id),
            addChild: (parentId) => void pages.addPage(parentId),
            move: pages.move,
            remove: (id) => void pages.remove(id),
          }}
        />
      )}
    </SidebarGroup>
  );
}
