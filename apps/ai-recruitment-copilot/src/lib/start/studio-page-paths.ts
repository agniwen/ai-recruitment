import type { StudioPagePermissionAction } from "@/lib/start/auth-session-types";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import type {
  PermissionResource,
  WorkspacePermissionStatements,
} from "@arc/shared/permission-statements";

// Data permissions required by each page's primary read endpoint.
const STUDIO_PAGE_READ_RESOURCES: Partial<Record<StudioPagePermissionAction, PermissionResource>> =
  {
    aiReview: "aiReview",
    departments: "department",
    forms: "candidateForm",
    globalConfig: "globalConfig",
    hiringUnits: "hiringUnit",
    interviewQuestions: "questionTemplate",
    interviewers: "interviewer",
    interviews: "interview",
    jobDescriptions: "jd",
    resumePool: "resumePool",
    resumes: "resumeLibrary",
  };

export function canAccessStudioPage(
  permissions: WorkspacePermissionStatements,
  action: StudioPagePermissionAction,
): boolean {
  if (!hasPermissionInStatements(permissions, "page", action)) {
    return false;
  }
  // This page lists managed mailboxes; personal mailbox read access is insufficient.
  if (action === "mailIngestAccounts") {
    return hasPermissionInStatements(permissions, "mailIngestAccount", "manage");
  }
  const resource = STUDIO_PAGE_READ_RESOURCES[action];
  return !resource || hasPermissionInStatements(permissions, resource, "read");
}

/**
 * Ordered Studio pages used for default landing redirects and path→action mapping.
 * Keep in sync with studio sidebar navigation.
 */
export const STUDIO_PAGE_PATHS = [
  { action: "resumes", path: "/resumes" },
  { action: "resumePool", path: "/resume-pool" },
  { action: "aiReview", path: "/ai-review" },
  { action: "interviews", path: "/interviews" },
  { action: "calendar", path: "/calendar" },
  { action: "dashboard", path: "/dashboard" },
  { action: "odcAnalysis", path: "/odc-analysis" },
  { action: "dataExport", path: "/data-export" },
  { action: "hiringUnits", path: "/hiring-units" },
  { action: "hiringUnits", path: "/resume-sources" },
  { action: "departments", path: "/departments" },
  { action: "interviewers", path: "/interviewers" },
  { action: "jobDescriptions", path: "/job-descriptions" },
  { action: "forms", path: "/forms" },
  { action: "interviewQuestions", path: "/interview-questions" },
  { action: "me", path: "/me" },
  { action: "members", path: "/members" },
  { action: "mailIngestAccounts", path: "/mail-ingest-accounts" },
  { action: "preRegistrations", path: "/pre-registrations" },
  { action: "permissions", path: "/permissions" },
  { action: "globalConfig", path: "/global-config" },
] as const satisfies readonly {
  action: StudioPagePermissionAction;
  path: string;
}[];
