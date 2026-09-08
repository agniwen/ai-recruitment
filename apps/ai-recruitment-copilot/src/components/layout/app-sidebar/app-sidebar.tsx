"use client";

import type { ComponentProps } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  SidebarBodyPortalTarget,
  SidebarFooterPortalTarget,
  SidebarHeaderPortalTarget,
} from "./portals";
import {
  SidebarBodySkeleton,
  SidebarFooterSkeleton,
  SidebarSlotHydrationFallback,
} from "./sidebar-slot-skeleton";
import { RecruitmentCopilotBrand } from "./recruitment-copilot-brand";
import { SidebarTabs } from "./sidebar-tabs";

type AppSidebarProps = ComponentProps<typeof Sidebar>;

export function AppSidebar({ ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader className="relative gap-3 overflow-x-clip">
        <div className="flex w-full flex-col gap-3 group-data-[collapsible=icon]:gap-0">
          <RecruitmentCopilotBrand />
          <SidebarTabs />
        </div>
        <SidebarHeaderPortalTarget className="contents" />
      </SidebarHeader>
      <SidebarContent className="relative overflow-x-hidden">
        <SidebarBodyPortalTarget className="contents" />
        <SidebarSlotHydrationFallback>
          <SidebarBodySkeleton />
        </SidebarSlotHydrationFallback>
      </SidebarContent>
      <SidebarFooter className="p-0">
        <SidebarFooterPortalTarget className="contents" />
        <SidebarSlotHydrationFallback>
          <SidebarFooterSkeleton />
        </SidebarSlotHydrationFallback>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
