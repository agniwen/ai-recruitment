import { createFileRoute } from "@tanstack/react-router";
import { redirectToActiveWorkspace } from "@/lib/start/workspace-redirect";
import { resolveWorkspaceLandingHref } from "@/lib/start/workspace-landing";

function LegacyChatRoute() {
  return null;
}

export const Route = createFileRoute("/chat")({
  component: LegacyChatRoute,
  loader: async () =>
    await redirectToActiveWorkspace({
      callbackPath: "/chat",
      getDestination: (slug) => resolveWorkspaceLandingHref({ preferredArea: "chat", slug }),
    }),
});
