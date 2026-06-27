import { getStudioPageAccessState } from "@/lib/start/auth-session";
import type { StudioPagePermissionAction } from "@/lib/start/auth-session-types";

type PreferredWorkspaceArea = "chat" | "studio";

export const STUDIO_PAGE_PATHS = [
  { action: "resumes", path: "/resumes" },
  { action: "resumePool", path: "/resume-pool" },
  { action: "interviews", path: "/interviews" },
  { action: "dashboard", path: "/dashboard" },
  { action: "hiringUnits", path: "/hiring-units" },
  { action: "departments", path: "/departments" },
  { action: "interviewers", path: "/interviewers" },
  { action: "jobDescriptions", path: "/job-descriptions" },
  { action: "forms", path: "/forms" },
  { action: "interviewQuestions", path: "/interview-questions" },
  { action: "me", path: "/me" },
  { action: "members", path: "/members" },
  { action: "mailIngestAccounts", path: "/mail-ingest-accounts" },
  { action: "agentDebug", path: "/agent-debug" },
  { action: "permissions", path: "/permissions" },
  { action: "globalConfig", path: "/global-config" },
] as const satisfies readonly {
  action: StudioPagePermissionAction;
  path: string;
}[];

async function canAccessPage(slug: string, action: StudioPagePermissionAction): Promise<boolean> {
  const state = await getStudioPageAccessState({ data: { action, slug } });
  return state.status === "ready" && state.allowed;
}

export async function findFirstAllowedStudioPath(slug: string): Promise<string | null> {
  for (const item of STUDIO_PAGE_PATHS) {
    if (await canAccessPage(slug, item.action)) {
      return item.path;
    }
  }
  return null;
}

export async function resolveWorkspaceLandingHref({
  preferredArea = "studio",
  slug,
}: {
  preferredArea?: PreferredWorkspaceArea;
  slug: string;
}): Promise<string | null> {
  if (preferredArea === "chat" && (await canAccessPage(slug, "chat"))) {
    return `/w/${slug}/chat`;
  }

  const studioPath = await findFirstAllowedStudioPath(slug);
  if (studioPath) {
    return `/w/${slug}/studio${studioPath}`;
  }

  if (preferredArea === "studio" && (await canAccessPage(slug, "chat"))) {
    return `/w/${slug}/chat`;
  }

  return null;
}
