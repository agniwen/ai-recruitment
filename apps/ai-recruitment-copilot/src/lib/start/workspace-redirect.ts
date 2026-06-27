import { notFound, redirect } from "@tanstack/react-router";
import { NO_ACCESS_WORKSPACE_ROLE } from "@arc/shared/permissions";
import { getActiveOrganizationState } from "@/lib/start/auth-session";

export async function redirectToActiveWorkspace({
  callbackPath,
  getDestination,
}: {
  callbackPath: string;
  getDestination: (slug: string) => Promise<string | null> | string | null;
}) {
  const state = await getActiveOrganizationState();
  if (state.status === "unauthenticated") {
    throw redirect({
      href: `/login?callbackURL=${encodeURIComponent(callbackPath)}`,
    });
  }

  if (state.status === "no_active_workspace") {
    throw redirect({ href: "/select-workspace" });
  }

  if (state.member.role === NO_ACCESS_WORKSPACE_ROLE) {
    throw redirect({ href: "/wait" });
  }

  const href = await getDestination(state.workspace.slug);
  if (!href) {
    throw notFound();
  }

  throw redirect({ href });
}
