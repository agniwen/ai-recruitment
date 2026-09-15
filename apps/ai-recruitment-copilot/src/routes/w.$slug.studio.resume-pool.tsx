import { createFileRoute } from "@tanstack/react-router";

import { ResumePoolPage } from "@/components/features/studio/resume-pool/resume-pool-page";
import type { ResumePoolSearch } from "@/components/features/studio/resume-pool/resume-pool-page";
import {
  normalizeResumePoolUploaderId,
  normalizeScope,
} from "@/components/features/studio/resume-pool/resume-pool-page-model";
import { ResumePoolPageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/resume-pool")({
  validateSearch: (search: Record<string, unknown>): ResumePoolSearch => {
    const value = (key: string) => (typeof search[key] === "string" ? search[key] : undefined);
    return {
      id: value("id"),
      importStatus: value("importStatus"),
      parseStatus: value("parseStatus"),
      search: value("search"),
      scope: normalizeScope(search.scope),
      sortBy: value("sortBy"),
      sortOrder: value("sortOrder"),
      sourceType: value("sourceType"),
      uploaderId: normalizeResumePoolUploaderId(search.uploaderId),
    };
  },
  head: () => ({
    meta: [{ title: formatDocumentTitle("简历池") }],
  }),
  component: ResumePoolPage,
  pendingComponent: ResumePoolPageSkeleton,
});
