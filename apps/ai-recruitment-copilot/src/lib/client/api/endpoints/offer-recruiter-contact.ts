import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "../rpc-fetch";

export function getCurrentOfferRecruiterContact(
  slug: string,
  candidateId: string,
): Promise<OfferRecruiterContactState | null> {
  return rpcFetch<OfferRecruiterContactState | null>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"]["recruiter-contact"].current.$get({
      param: { id: candidateId, slug },
    }),
    "加载待补充的候选人私人 TG 失败",
  );
}

export function getOfferRecruiterContact(
  slug: string,
  candidateId: string,
  draftId: string,
): Promise<OfferRecruiterContactState> {
  return rpcFetch<OfferRecruiterContactState>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"][":draftId"][
      "recruiter-contact"
    ].$get({ param: { draftId, id: candidateId, slug } }),
    "加载招聘人员确认信息失败",
  );
}

export function submitOfferRecruiterContact(
  slug: string,
  candidateId: string,
  draftId: string,
  input: { revision: number; candidatePrivateTelegram: string },
): Promise<OfferRecruiterContactState> {
  return rpcFetch<OfferRecruiterContactState>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"][":draftId"][
      "recruiter-contact"
    ].$post({ json: input, param: { draftId, id: candidateId, slug } }),
    "确认候选人私人 TG 失败",
  );
}
