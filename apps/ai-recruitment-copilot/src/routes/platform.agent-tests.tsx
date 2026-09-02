import { createFileRoute } from "@tanstack/react-router";
import { AgentTestsPanel } from "@/components/features/platform/agent-tests/agent-tests-panel";
import { formatDocumentTitle } from "@/lib/start/document-title";

function PlatformAgentTestsRoute() {
  return (
    <div className="container mx-auto">
      <AgentTestsPanel />
    </div>
  );
}

export const Route = createFileRoute("/platform/agent-tests")({
  component: PlatformAgentTestsRoute,
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · Agent 测试") }] }),
});
