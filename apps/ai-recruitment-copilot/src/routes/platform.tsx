import {
  Outlet,
  createFileRoute,
  redirect,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import { platformMfaHref, PLATFORM_MFA_PATH } from "@arc/shared/platform-security";
import { PlatformSessionGuard } from "@/components/features/platform/security/platform-session-guard";
import { PlatformLayout } from "@/components/features/platform/platform-layout";
import { getPlatformAdminState } from "@/lib/start/platform-admin";
import { documentTitleMeta } from "@/lib/start/document-title";

function PlatformRoute() {
  const { platformAdmin: state } = useRouteContext({ from: "/platform" });
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  if (pathname === PLATFORM_MFA_PATH) {
    return <Outlet />;
  }
  if (state.status !== "ready") {
    return null;
  }
  return (
    <PlatformSessionGuard expiresAt={state.expiresAt}>
      <PlatformLayout>
        <Outlet />
      </PlatformLayout>
    </PlatformSessionGuard>
  );
}

export const Route = createFileRoute("/platform")({
  beforeLoad: async ({ location }) => {
    const state = await getPlatformAdminState();
    if (state.status === "unauthenticated") {
      throw redirect({ href: "/login" });
    }
    if (state.status === "forbidden") {
      throw redirect({ href: "/" });
    }
    if (state.status === "mfa-required" && location.pathname !== PLATFORM_MFA_PATH) {
      throw redirect({ href: platformMfaHref(location.href), replace: true });
    }
    if (state.status === "ready" && location.pathname === "/platform") {
      throw redirect({ href: "/platform/organizations" });
    }
    return { platformAdmin: state };
  },
  head: ({ matches }) => ({
    meta: documentTitleMeta(matches),
  }),
  component: PlatformRoute,
});
