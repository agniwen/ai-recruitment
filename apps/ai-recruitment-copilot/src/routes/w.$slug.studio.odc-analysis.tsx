import { createFileRoute } from "@tanstack/react-router";
import { OdcAnalysisPage } from "@/components/features/studio/odc-analysis/odc-analysis-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/odc-analysis")({
  component: OdcAnalysisPage,
  head: () => ({
    meta: [{ title: formatDocumentTitle("ODC分析") }],
  }),
});
