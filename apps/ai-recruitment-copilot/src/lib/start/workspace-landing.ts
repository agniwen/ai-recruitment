import type { WorkspacePermissionStatements } from "@arc/shared/permission-statements";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import type { StudioPagePermissionAction } from "@/lib/start/auth-session-types";
import { STUDIO_PAGE_PATHS } from "@/lib/start/studio-page-paths";

type PreferredWorkspaceArea = "agent" | "chat" | "studio";

function canAccessPage(
  permissions: WorkspacePermissionStatements,
  action: StudioPagePermissionAction,
): boolean {
  return hasPermissionInStatements(permissions, "page", action);
}

/** page:chat gates the Agent tab (legacy Chat / 「聊天助手」 page permission). */
function canAccessAgent(permissions: WorkspacePermissionStatements): boolean {
  return canAccessPage(permissions, "chat");
}

export function findFirstAllowedStudioPath(
  permissions: WorkspacePermissionStatements,
): string | null {
  for (const item of STUDIO_PAGE_PATHS) {
    if (canAccessPage(permissions, item.action)) {
      return item.path;
    }
  }
  return null;
}

export function resolveWorkspaceLandingHref({
  permissions,
  preferredArea = "studio",
  slug,
}: {
  permissions: WorkspacePermissionStatements;
  preferredArea?: PreferredWorkspaceArea;
  slug: string;
}): string | null {
  const prefersAgent = preferredArea === "agent" || preferredArea === "chat";
  if (prefersAgent && canAccessAgent(permissions)) {
    return `/w/${slug}/agent`;
  }

  const studioPath = findFirstAllowedStudioPath(permissions);
  if (studioPath) {
    return `/w/${slug}/studio${studioPath}`;
  }

  if (preferredArea === "studio" && canAccessAgent(permissions)) {
    return `/w/${slug}/agent`;
  }

  return null;
}
