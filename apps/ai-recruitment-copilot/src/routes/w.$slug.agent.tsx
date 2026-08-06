import type { ReactNode } from "react";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { hasPermissionInStatements } from "@arc/shared/permission-statements";
import { ChatHeader, ChatHeaderTitleProvider } from "@/components/features/chat/chat-header";
import { PendingOutlet } from "@/components/layout/pending-outlet";
import { SidebarInset } from "@/components/ui/sidebar";
import { cn } from "@arc/shared/utils/cn";
import { documentTitleMeta } from "@/lib/start/document-title";

function AgentLayout({ children }: { children: ReactNode }) {
  return (
    <ChatHeaderTitleProvider>
      <SidebarInset
        className={cn(
          "isolate h-dvh border border-border overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-center before:bg-cover before:bg-no-repeat before:content-[''] md:h-[calc(100dvh-1.5rem)]",
        )}
      >
        <ChatHeader />
        <PendingOutlet className="flex min-h-0 flex-1 flex-col">{children}</PendingOutlet>
      </SidebarInset>
    </ChatHeaderTitleProvider>
  );
}

function AgentShellRoute() {
  return (
    <AgentLayout>
      <Outlet />
    </AgentLayout>
  );
}

export const Route = createFileRoute("/w/$slug/agent")({
  component: AgentShellRoute,
  // Reuse page:chat (「聊天助手」/ Chat page browse). Without it, bounce to Studio 简历库.
  loader: async ({ params, parentMatchPromise }) => {
    const parentMatch = await parentMatchPromise;
    const state = parentMatch.loaderData;
    if (
      !state ||
      state.status !== "ready" ||
      !hasPermissionInStatements(state.permissions, "page", "chat")
    ) {
      throw redirect({ href: `/w/${params.slug}/studio/resumes` });
    }
    return null;
  },
  head: ({ matches }) => ({
    meta: documentTitleMeta(matches),
  }),
});
