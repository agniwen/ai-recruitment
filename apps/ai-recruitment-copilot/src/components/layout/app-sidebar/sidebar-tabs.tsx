"use client";

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useGlimm } from "glimm/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/client/auth-client";
import type { statement } from "@arc/shared/permissions";

type SidebarTabValue = "chat" | "studio";
type StudioTabPageAction = (typeof statement)["page"][number];

const STUDIO_TAB_PAGE_PATHS = [
  { action: "resumes", path: "/studio/resumes" },
  { action: "resumePool", path: "/studio/resume-pool" },
  { action: "interviews", path: "/studio/interviews" },
  { action: "dashboard", path: "/studio/dashboard" },
  { action: "hiringUnits", path: "/studio/hiring-units" },
  { action: "departments", path: "/studio/departments" },
  { action: "interviewers", path: "/studio/interviewers" },
  { action: "jobDescriptions", path: "/studio/job-descriptions" },
  { action: "forms", path: "/studio/forms" },
  { action: "interviewQuestions", path: "/studio/interview-questions" },
  { action: "me", path: "/studio/me" },
  { action: "members", path: "/studio/members" },
  { action: "mailIngestAccounts", path: "/studio/mail-ingest-accounts" },
  { action: "agentDebug", path: "/studio/agent-debug" },
  { action: "permissions", path: "/studio/permissions" },
  { action: "globalConfig", path: "/studio/global-config" },
] as const satisfies readonly {
  action: StudioTabPageAction;
  path: `/studio/${string}`;
}[];

// 从 pathname 解析当前 workspace slug;非 /w/[slug]/* 路径返回 null。
function extractWorkspaceSlug(pathname: string): string | null {
  const match = pathname.match(/^\/w\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function resolveActiveTab(pathname: string): SidebarTabValue | null {
  if (!pathname.startsWith("/w/")) {
    return null;
  }
  if (pathname.includes("/studio")) {
    return "studio";
  }
  if (pathname.includes("/chat")) {
    return "chat";
  }
  return null;
}

function useFirstAllowedStudioPath(): string | null {
  const canAccessResumes = useHasPermission("page", "resumes");
  const canAccessResumePool = useHasPermission("page", "resumePool");
  const canAccessInterviews = useHasPermission("page", "interviews");
  const canAccessDashboard = useHasPermission("page", "dashboard");
  const canAccessHiringUnits = useHasPermission("page", "hiringUnits");
  const canAccessDepartments = useHasPermission("page", "departments");
  const canAccessInterviewers = useHasPermission("page", "interviewers");
  const canAccessJobDescriptions = useHasPermission("page", "jobDescriptions");
  const canAccessForms = useHasPermission("page", "forms");
  const canAccessInterviewQuestions = useHasPermission("page", "interviewQuestions");
  const canAccessMe = useHasPermission("page", "me");
  const canAccessMembers = useHasPermission("page", "members");
  const canAccessMailIngestAccounts = useHasPermission("page", "mailIngestAccounts");
  const canAccessAgentDebug = useHasPermission("page", "agentDebug");
  const canAccessPermissions = useHasPermission("page", "permissions");
  const canAccessGlobalConfig = useHasPermission("page", "globalConfig");
  const allowedByAction = {
    agentDebug: canAccessAgentDebug,
    dashboard: canAccessDashboard,
    departments: canAccessDepartments,
    forms: canAccessForms,
    globalConfig: canAccessGlobalConfig,
    hiringUnits: canAccessHiringUnits,
    interviewQuestions: canAccessInterviewQuestions,
    interviewers: canAccessInterviewers,
    interviews: canAccessInterviews,
    jobDescriptions: canAccessJobDescriptions,
    mailIngestAccounts: canAccessMailIngestAccounts,
    me: canAccessMe,
    members: canAccessMembers,
    permissions: canAccessPermissions,
    resumePool: canAccessResumePool,
    resumes: canAccessResumes,
  } satisfies Record<(typeof STUDIO_TAB_PAGE_PATHS)[number]["action"], boolean>;

  return STUDIO_TAB_PAGE_PATHS.find((item) => allowedByAction[item.action])?.path ?? null;
}

export function SidebarTabs() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { sweep } = useGlimm();
  const activeOrganization = authClient.useActiveOrganization();
  const activeTab = resolveActiveTab(pathname);
  const slug = extractWorkspaceSlug(pathname) ?? activeOrganization.data?.slug ?? null;
  const canAccessChat = useHasPermission("page", "chat");
  const firstAllowedStudioPath = useFirstAllowedStudioPath();

  const handleChange = (value: string) => {
    // 缺 slug 时无法构造路径——回到根路径让根路由解析活跃 workspace。
    // Without a slug we can't build the target — fall back to root and let
    // src/routes/index.tsx redirect to the active workspace.
    if (!slug) {
      void navigate({ to: "/" });
      return;
    }

    const nextTab = value as SidebarTabValue;
    if (nextTab === "chat" && !canAccessChat) {
      return;
    }

    let target = `/w/${slug}/studio`;
    if (nextTab === "chat") {
      target = `/w/${slug}/chat`;
    } else if (firstAllowedStudioPath) {
      target = `/w/${slug}${firstAllowedStudioPath}`;
    }

    if (target !== pathname) {
      void sweep(
        () => {
          void navigate({ to: target });
        },
        {
          direction: nextTab === "chat" ? "rtl" : "ltr",
        },
      ).done;
    }
  };

  return (
    <Tabs
      // Manual activation: Radix's default "automatic" mode calls
      // onValueChange on focus — when sonner restores focus to the
      // previously-active tab trigger after dismissing a toast, that
      // would route us back to the wrong tab.
      activationMode="manual"
      className="w-full group-data-[collapsible=icon]:hidden"
      onValueChange={handleChange}
      value={activeTab ?? "chat"}
    >
      <TabsList className="w-full  bg-sidebar/60  select-none">
        <TabsTrigger disabled={!canAccessChat} value="chat">
          Chat
        </TabsTrigger>
        <TabsTrigger value="studio">Studio</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
