"use client";

import { useRouterState } from "@tanstack/react-router";
import { SidebarInsetHeader } from "@/components/layout/app-sidebar/sidebar-inset-header";
import { resolveStudioSidebarNavItem } from "@/components/features/studio/studio-sidebar-slots";
import { WorkspaceSwitcher } from "@/components/features/workspace/workspace-switcher";
import { useStudioHeaderOverrideValue } from "@/components/features/studio/studio-header-context";
import { UploadTaskInbox } from "@/components/features/studio/upload-task-inbox";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

interface RouteMeta {
  title: string;
}

const DEFAULT_META: RouteMeta = { title: "简历库" };

export function resolveRouteMeta(pathname: string): RouteMeta {
  const navItem = resolveStudioSidebarNavItem(pathname);
  return navItem ? { title: navItem.title } : DEFAULT_META;
}

export function SiteHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { title } = resolveRouteMeta(pathname);
  const ActiveMenuIcon = resolveStudioSidebarNavItem(pathname)?.icon;
  const headerOverride = useStudioHeaderOverrideValue();

  return (
    <SidebarInsetHeader
      activeMenuIcon={ActiveMenuIcon ? <ActiveMenuIcon /> : undefined}
      actions={
        <>
          <WorkspaceSwitcher />
          <UploadTaskInbox />
        </>
      }
      breadcrumb={
        headerOverride ?? (
          <Breadcrumb>
            <BreadcrumbList>
              {/* <BreadcrumbItem className="hidden md:block">Studio</BreadcrumbItem> */}
              {/* <BreadcrumbSeparator className="hidden md:block" /> */}
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )
      }
    />
  );
}
