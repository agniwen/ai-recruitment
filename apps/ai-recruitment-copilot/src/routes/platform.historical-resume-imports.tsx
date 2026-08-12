import { createFileRoute } from "@tanstack/react-router";
import { HistoricalResumeImportsGrid } from "@/components/features/platform/historical-resume-imports/historical-resume-imports-grid";
import { formatDocumentTitle } from "@/lib/start/document-title";

type SearchPrimitive = boolean | number | string;

function coerceSearchParams(search: Record<string, unknown>) {
  const output: Record<string, SearchPrimitive | SearchPrimitive[] | undefined> = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value.filter(
        (item): item is SearchPrimitive =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
    }
  }
  return output;
}

function PlatformHistoricalResumeImportsRoute() {
  return (
    <div className="container mx-auto">
      <HistoricalResumeImportsGrid />
    </div>
  );
}

export const Route = createFileRoute("/platform/historical-resume-imports")({
  validateSearch: coerceSearchParams,
  head: () => ({ meta: [{ title: formatDocumentTitle("平台 · 历史简历解析") }] }),
  component: PlatformHistoricalResumeImportsRoute,
});
