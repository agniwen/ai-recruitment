"use client";

import {
  IconBuilding,
  IconDatabase,
  IconGauge,
  IconHistory,
  IconInbox,
  IconListCheck,
  IconRadio,
  IconRobot,
  IconServer,
  IconUsers,
} from "@tabler/icons-react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  SidebarBodyPortalContent,
  SidebarFooterPortalContent,
} from "@/components/layout/app-sidebar/portals";
import { SidebarUserSection } from "@/components/layout/sidebar-user-section";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export interface NavItem {
  path: string;
  icon: typeof IconBuilding;
  title: string;
  activePaths?: string[];
}

interface NavSection {
  id: string;
  items: NavItem[];
  title?: string;
}

const manageNavSections: NavSection[] = [
  {
    id: "platform-management",
    items: [
      {
        icon: IconBuilding,
        path: "/platform/organizations",
        title: "所有工作区",
      },
      {
        icon: IconUsers,
        path: "/platform/users",
        title: "所有用户",
      },
      {
        icon: IconInbox,
        path: "/platform/mail-ingest-accounts",
        title: "邮箱监听",
      },
      {
        icon: IconListCheck,
        path: "/platform/queues",
        title: "队列任务",
      },
      {
        icon: IconDatabase,
        path: "/platform/resume-parse-cache",
        title: "解析缓存",
      },
      {
        icon: IconHistory,
        path: "/platform/historical-resume-imports",
        title: "历史简历解析",
      },
      {
        icon: IconRobot,
        path: "/platform/agent-tests",
        title: "Agent 测试",
      },
    ],
    title: "平台管理",
  },
  {
    id: "livekit",
    items: [
      {
        icon: IconServer,
        path: "/platform/livekit/overview",
        title: "服务概览",
      },
      {
        icon: IconRadio,
        path: "/platform/livekit/rooms",
        title: "实时房间",
      },
      {
        icon: IconGauge,
        path: "/platform/livekit/metrics",
        title: "运行指标",
      },
    ],
    title: "LiveKit",
  },
];

function matchesNavItem(pathname: string, item: NavItem): boolean {
  const matches = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  return matches(item.path) || item.activePaths?.some(matches) === true;
}

export function resolvePlatformSidebarNavItem(pathname: string): NavItem | undefined {
  const sections = manageNavSections;
  return sections
    .flatMap((section) => section.items)
    .find((item) => matchesNavItem(pathname, item));
}

export function PlatformSidebarSlots() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { state } = useSidebar();
  const navSections = manageNavSections;
  const activeNavItem = resolvePlatformSidebarNavItem(pathname);

  return (
    <>
      <SidebarBodyPortalContent>
        {navSections.map((section) => (
          <SidebarGroup key={section.id}>
            {section.title ? <SidebarGroupLabel>{section.title}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        className="cursor-default select-none transition-[width,height,padding,background-color,border-color,color,opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] data-[active=false]:opacity-90 data-[active=false]:hover:opacity-100 motion-reduce:transition-none motion-reduce:active:scale-100"
                        isActive={item === activeNavItem}
                        render={
                          <Link to={item.path}>
                            <Icon />
                            <span>{item.title}</span>
                          </Link>
                        }
                        size="default"
                        tooltip={item.title}
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarBodyPortalContent>

      <SidebarFooterPortalContent>
        <SidebarUserSection
          callbackURL="/platform/organizations"
          collapsed={state === "collapsed"}
          showHomeLink={true}
        />
      </SidebarFooterPortalContent>
    </>
  );
}
