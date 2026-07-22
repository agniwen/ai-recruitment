"use client";

import {
  IconActivity as ActivityIcon,
  IconBook as BookOpenIcon,
  IconBraces as BracesIcon,
  IconBuilding as Building2Icon,
  IconChartBar as ChartBarIcon,
  IconChartLine as ChartLineIcon,
  IconDatabase as DatabaseIcon,
  IconFilter as FilterIcon,
  IconFlask as FlaskConicalIcon,
  IconFolderCode as FolderCodeIcon,
  IconGauge as GaugeIcon,
  IconGitBranch as GitBranchIcon,
  IconInbox as InboxIcon,
  IconListCheck as ListChecksIcon,
  IconLogs as LogsIcon,
  IconPlugConnected as PlugZapIcon,
  IconPrompt as MessageSquareTextIcon,
  IconRobot as RobotIcon,
  IconSettings as SettingsIcon,
  IconTool as WrenchIcon,
  IconUsers as UsersIcon,
} from "@tabler/icons-react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  SidebarBodyPortalContent,
  SidebarFooterPortalContent,
  SidebarHeaderPortalContent,
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
import { PlatformSidebarTabs, resolvePlatformSidebarTab } from "./platform-sidebar-tabs";

interface NavItem {
  path: string;
  icon: typeof Building2Icon;
  title: string;
  activePaths?: string[];
}

interface NavSection {
  items: NavItem[];
  title?: string;
}

const manageNavSections: NavSection[] = [
  {
    items: [
      {
        icon: Building2Icon,
        path: "/platform/organizations",
        title: "所有工作区",
      },
      {
        icon: UsersIcon,
        path: "/platform/users",
        title: "所有用户",
      },
      {
        icon: InboxIcon,
        path: "/platform/mail-ingest-accounts",
        title: "邮箱监听",
      },
      {
        icon: ListChecksIcon,
        path: "/platform/queues",
        title: "队列任务",
      },
    ],
    title: "平台管理",
  },
];

// Keep this lightweight host projection aligned with upstream navigation. Importing
// the playground registry here would pull Studio UI into every Platform page.
const mastraNavSections: NavSection[] = [
  {
    items: [
      { icon: RobotIcon, path: "/platform/mastra-studio/agents", title: "Agents" },
      {
        icon: MessageSquareTextIcon,
        path: "/platform/mastra-studio/prompts",
        title: "Prompts",
      },
      {
        icon: GitBranchIcon,
        path: "/platform/mastra-studio/workflows",
        title: "Workflows",
      },
      {
        icon: FilterIcon,
        path: "/platform/mastra-studio/processors",
        title: "Processors",
      },
      {
        icon: PlugZapIcon,
        path: "/platform/mastra-studio/mcps",
        title: "MCP Servers",
      },
      { icon: WrenchIcon, path: "/platform/mastra-studio/tools", title: "Tools" },
      {
        icon: FolderCodeIcon,
        path: "/platform/mastra-studio/workspaces",
        title: "Workspaces",
      },
      {
        icon: BracesIcon,
        path: "/platform/mastra-studio/request-context",
        title: "Request Context",
      },
    ],
    title: "Primitives",
  },
  {
    items: [
      {
        icon: ChartBarIcon,
        path: "/platform/mastra-studio/evaluation",
        title: "Overview",
      },
      { icon: GaugeIcon, path: "/platform/mastra-studio/scorers", title: "Scorers" },
      { icon: DatabaseIcon, path: "/platform/mastra-studio/datasets", title: "Datasets" },
      {
        icon: FlaskConicalIcon,
        path: "/platform/mastra-studio/experiments",
        title: "Experiments",
      },
    ],
    title: "Evaluation",
  },
  {
    items: [
      { icon: ChartLineIcon, path: "/platform/mastra-studio/metrics", title: "Metrics" },
      {
        activePaths: ["/platform/mastra-studio/traces"],
        icon: ActivityIcon,
        path: "/platform/mastra-studio/observability",
        title: "Traces",
      },
      { icon: LogsIcon, path: "/platform/mastra-studio/logs", title: "Logs" },
    ],
    title: "Observability",
  },
  {
    items: [
      { icon: SettingsIcon, path: "/platform/mastra-studio/settings", title: "Settings" },
      { icon: BookOpenIcon, path: "/platform/mastra-studio/resources", title: "Resources" },
    ],
  },
];

export function PlatformSidebarSlots() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { state } = useSidebar();
  const activeTab = resolvePlatformSidebarTab(pathname);
  const navSections = activeTab === "mastra" ? mastraNavSections : manageNavSections;

  const isActive = (item: NavItem) => {
    const matches = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
    return matches(item.path) || item.activePaths?.some(matches) === true;
  };

  return (
    <>
      <SidebarHeaderPortalContent>
        <PlatformSidebarTabs />
      </SidebarHeaderPortalContent>

      <SidebarBodyPortalContent>
        {navSections.map((section, index) => (
          <SidebarGroup key={section.title ?? `bottom-${index}`}>
            {section.title ? <SidebarGroupLabel>{section.title}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive(item)}
                        render={
                          <Link to={item.path}>
                            <Icon />
                            <span>{item.title}</span>
                          </Link>
                        }
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
