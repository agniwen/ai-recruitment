import { createFileRoute } from "@tanstack/react-router";
import { ResumeSourceManagementPage } from "@/components/features/studio/resume-sources/resume-source-management-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/resume-sources")({
  component: ResumeSourceManagementPage,
  head: () => ({ meta: [{ title: formatDocumentTitle("部门/中心（来源）") }] }),
});
