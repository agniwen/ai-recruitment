import type { OfferDraftRecord, OfferSscState } from "@arc/shared/studio-pipeline-stages";
import { rpc } from "@/lib/client/rpc";
import { apiFetch } from "../client";
import { rpcFetch } from "../rpc-fetch";

export function getCurrentOfferSscState(
  slug: string,
  candidateId: string,
): Promise<OfferSscState | null> {
  return rpcFetch<OfferSscState | null>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"].ssc.current.$get({
      param: { id: candidateId, slug },
    }),
    "加载当前 SSC 确认状态失败",
  );
}

export function receiveOfferSscConfirmation(
  slug: string,
  candidateId: string,
  draftId: string,
  input: { revision: number },
): Promise<OfferDraftRecord> {
  return rpcFetch<OfferDraftRecord>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"][":draftId"].ssc.receive.$post({
      json: input,
      param: { draftId, id: candidateId, slug },
    }),
    "SSC接收确认失败",
  );
}

export function completeOfferSscConfirmation(
  slug: string,
  candidateId: string,
  draftId: string,
  input: { revision: number; internalApprovalConfirmed: true },
  file: File | null = null,
): Promise<OfferDraftRecord> {
  if (file) {
    const form = new FormData();
    form.set("revision", String(input.revision));
    form.set("internalApprovalConfirmed", "true");
    form.set("file", file);
    return apiFetch<OfferDraftRecord>(
      `/api/w/${encodeURIComponent(slug)}/studio/interviews/${encodeURIComponent(candidateId)}/offer-drafts/${encodeURIComponent(draftId)}/ssc/complete-with-attachment`,
      { body: form, method: "POST" },
    );
  }
  return rpcFetch<OfferDraftRecord>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"][":draftId"].ssc.complete.$post({
      json: input,
      param: { draftId, id: candidateId, slug },
    }),
    "SSC完成确认失败",
  );
}

export function offerSscCompletionAttachmentUrl(
  slug: string,
  candidateId: string,
  draftId: string,
) {
  return `/api/w/${encodeURIComponent(slug)}/studio/interviews/${encodeURIComponent(candidateId)}/offer-drafts/${encodeURIComponent(draftId)}/ssc/completion-attachment`;
}

export function getOfferSscTelegramLink(
  slug: string,
  candidateId: string,
  draftId: string,
): Promise<{ url: string | null }> {
  return rpcFetch<{ url: string | null }>(
    rpc.api.w[":slug"].studio.interviews[":id"]["offer-drafts"][":draftId"].ssc[
      "telegram-link"
    ].$get({ param: { draftId, id: candidateId, slug } }),
    "加载 Telegram 确认入口失败",
  );
}
