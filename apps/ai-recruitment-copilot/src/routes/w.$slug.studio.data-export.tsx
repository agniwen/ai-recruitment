import { createFileRoute } from "@tanstack/react-router";
import { DataExportPage } from "@/components/features/studio/data-export/data-export-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/data-export")({
  component: DataExportPage,
  head: () => ({
    meta: [{ title: formatDocumentTitle("导出数据") }],
  }),
});
