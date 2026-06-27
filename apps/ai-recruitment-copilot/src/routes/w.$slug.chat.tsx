import type { ReactNode } from "react";
import { Outlet, createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { ChatHeader } from "@/components/features/chat/chat-header";
import { PendingOutlet } from "@/components/layout/pending-outlet";
import { ChatSidebarSlots } from "@/components/features/chat/chat-sidebar-slots";
import { SidebarInset } from "@/components/ui/sidebar";
import { getStudioPageAccessState } from "@/lib/start/auth-session";
import { resolveWorkspaceLandingHref } from "@/lib/start/workspace-landing";
import { cn } from "@arc/shared/utils/cn";

function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ChatSidebarSlots />
      <SidebarInset
        className={cn(
          "isolate h-dvh border border-border overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-center before:bg-cover before:bg-no-repeat before:content-[''] md:h-[calc(100dvh-1.5rem)]",
        )}
      >
        <ChatHeader />
        <PendingOutlet className="flex min-h-0 flex-1 flex-col">{children}</PendingOutlet>
      </SidebarInset>
    </>
  );
}

function ChatShellRoute() {
  return (
    <ChatLayout>
      <Outlet />
    </ChatLayout>
  );
}

export const Route = createFileRoute("/w/$slug/chat")({
  component: ChatShellRoute,
  loader: async ({ location, params }) => {
    const state = await getStudioPageAccessState({ data: { action: "chat", slug: params.slug } });
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(location.pathname)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    if (!state.allowed) {
      const href = await resolveWorkspaceLandingHref({
        preferredArea: "studio",
        slug: params.slug,
      });
      if (!href) {
        throw notFound();
      }
      throw redirect({ href });
    }
  },
});
