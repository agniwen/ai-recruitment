import { createFileRoute } from "@tanstack/react-router";
import { SecuritySettingsPage } from "@/components/features/platform/security/security-settings-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/platform/security")({
  component: SecuritySettingsPage,
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · 后台两步验证") }] }),
});
