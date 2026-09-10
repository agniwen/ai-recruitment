import type { WorkspaceAccessState } from "@/lib/start/auth-session-types";
import { canAccessStudioPage } from "../studio-page-paths";

export function canReadStudioResumes(
  access: Extract<WorkspaceAccessState, { status: "ready" }>,
): boolean {
  return canAccessStudioPage(access.permissions, "resumes");
}
