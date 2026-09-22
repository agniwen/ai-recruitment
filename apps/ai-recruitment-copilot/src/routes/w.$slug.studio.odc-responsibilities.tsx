import { createFileRoute } from "@tanstack/react-router";
import { OdcResponsibilitiesPage } from "@/components/features/studio/odc-responsibilities/odc-responsibilities-page";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/odc-responsibilities")({
  component: OdcResponsibilitiesPage,
  head: () => ({ meta: [{ title: formatDocumentTitle("ODC 负责范围") }] }),
});
