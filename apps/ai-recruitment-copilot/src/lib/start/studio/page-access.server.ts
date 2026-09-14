import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import { RECRUITING_DASHBOARD_ENABLED } from "@arc/shared/permissions";
import type {
  StudioPagePermissionAction,
  WorkspaceAccessState,
} from "@/lib/start/auth-session-types";
import { resolveWorkspaceAccessFromRequest } from "@/lib/start/auth-session.server";

export async function resolveAuthorizedStudioPageAccessFromRequest(
  slug: string,
  action: StudioPagePermissionAction,
): Promise<WorkspaceAccessState> {
  const access = await resolveWorkspaceAccessFromRequest(slug);
  if (access.status !== "ready") {
    return access;
  }
  if (
    (action === "dashboard" && !RECRUITING_DASHBOARD_ENABLED) ||
    !hasPermissionInStatements(access.permissions, "page", action)
  ) {
    return { status: "not_found" };
  }
  return access;
}
