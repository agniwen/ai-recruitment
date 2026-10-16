import { createFileRoute, useSearch } from "@tanstack/react-router";
import { platformMfaReturnTo } from "@arc/shared/platform-security";
import { PlatformMfaGate } from "@/components/features/platform/security/platform-mfa-gate";
import { formatDocumentTitle } from "@/lib/start/document-title";

function VerificationRoute() {
  const { returnTo } = useSearch({ from: "/platform/verify" });
  return <PlatformMfaGate returnTo={returnTo} />;
}

export const Route = createFileRoute("/platform/verify")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: platformMfaReturnTo(search.returnTo),
  }),
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · 两步验证") }] }),
  component: VerificationRoute,
});
