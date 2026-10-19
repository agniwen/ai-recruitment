import { createFileRoute } from "@tanstack/react-router";
import { InterviewConfigPage } from "@/components/features/platform/interview-config/interview-config-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/platform/interview-config")({
  component: InterviewConfigPage,
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · 面试参数") }] }),
});
