import { useLocation, useNavigate } from "@tanstack/react-router";
import { FileTextIcon, HouseIcon } from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { useNavigateToMainApp } from "./mainAppLocation";

/** A slim column of top-level destinations beside the thread list. */
export function SidebarNavRail() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  const onPages = useLocation({ select: (location) => location.pathname === "/pages" });
  const go = (destination: () => void) => {
    if (isMobile) setOpenMobile(false);
    destination();
  };
  return (
    <nav
      aria-label="App sections"
      className="flex w-12 shrink-0 flex-col items-center border-sidebar-border border-r pt-(--workspace-topbar-height) pb-2"
    >
      <SidebarMenu className="items-center">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="icon"
            isActive={!onPages}
            aria-label="Home"
            aria-current={onPages ? undefined : "page"}
            tooltip={{ children: "Home", side: "right" }}
            onClick={() => go(() => void navigateToMainApp())}
          >
            <HouseIcon />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="icon"
            isActive={onPages}
            aria-label="Pages"
            aria-current={onPages ? "page" : undefined}
            tooltip={{ children: "Pages", side: "right" }}
            onClick={() => go(() => void navigate({ to: "/pages", search: {} }))}
          >
            <FileTextIcon />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </nav>
  );
}
