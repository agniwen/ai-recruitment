import { createFileRoute } from "@tanstack/react-router";
import { AiReviewPage } from "@/components/features/studio/ai-review/ai-review-page";
import { StudioTablePageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { formatDocumentTitle } from "@/lib/start/document-title";

export const Route = createFileRoute("/w/$slug/studio/ai-review")({
  component: AiReviewPage,
  head: () => ({ meta: [{ title: formatDocumentTitle("AI 分析审批") }] }),
  pendingComponent: () => <StudioTablePageSkeleton filterCount={1} label="AI 分析审批" />,
});
