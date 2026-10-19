import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "../rpc-fetch";

export function fetchOfferCandidatePreview(token: string): Promise<OfferCandidatePreview | null> {
  return rpcFetch<OfferCandidatePreview>(
    rpc.api.public["offer-candidates"][":token"].$get(
      { param: { token } },
      { init: { cache: "no-store", referrerPolicy: "no-referrer" } },
    ),
    "候选人详情链接不可用",
    { allow404: true },
  );
}

export function offerCandidateResumeUrl(token: string) {
  return `/api/public/offer-candidates/${encodeURIComponent(token)}/resume`;
}
