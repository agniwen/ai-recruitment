import { createFileRoute, useParams } from "@tanstack/react-router";
import { OfferCandidatePreviewPage } from "@/components/features/offer-candidate-preview/page";
import { formatDocumentTitle } from "@/lib/start/document-title";

function OfferCandidateRoute() {
  const { token } = useParams({ from: "/offer-candidate/$token" });
  return <OfferCandidatePreviewPage key={token} token={token} />;
}

export const Route = createFileRoute("/offer-candidate/$token")({
  ssr: false,
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  }),
  head: () => ({
    meta: [
      { title: formatDocumentTitle("候选人及 Offer 详情") },
      { content: "noindex, nofollow", name: "robots" },
      { content: "no-referrer", name: "referrer" },
    ],
  }),
  component: OfferCandidateRoute,
});
