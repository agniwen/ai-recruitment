"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getOfferDraftStatusMeta,
  getOfferSscConfirmationMeta,
} from "@arc/db-schema/studio-interviews";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import {
  completeOfferSscConfirmation,
  getOfferSscTelegramLink,
  receiveOfferSscConfirmation,
} from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function useOfferSscConfirmation({
  canConfirm = false,
  canReceive = false,
  candidateId,
  disabled,
  draft,
  onSaved,
  slug,
}: {
  canConfirm?: boolean;
  canReceive?: boolean;
  candidateId: string;
  disabled?: boolean;
  draft: OfferDraftRecord;
  onSaved: () => void | Promise<void>;
  slug: string;
}) {
  const sscStatus = draft.sscConfirmationStatus ?? null;
  const canReceiveCurrent = canReceive && sscStatus === "pending" && draft.status === "draft";
  const canConfirmCurrent = canConfirm && sscStatus === "confirming" && draft.status === "draft";
  const { data: telegramLink } = useQuery({
    enabled: !disabled && (canReceiveCurrent || canConfirmCurrent),
    queryFn: () => getOfferSscTelegramLink(slug, candidateId, draft.id),
    queryKey: ["offer-ssc-telegram-link", slug, candidateId, draft.id],
  });
  const mutation = useMutation({
    mutationFn: (action: "receive" | "complete") => {
      const input = { revision: draft.sscRevision ?? 1 };
      return action === "receive"
        ? receiveOfferSscConfirmation(slug, candidateId, draft.id, input)
        : completeOfferSscConfirmation(slug, candidateId, draft.id, input);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "SSC确认操作失败"),
    onSuccess: async (_updated, action) => {
      await onSaved();
      toast.success(action === "receive" ? "SSC已接收，当前 Offer 确认中" : "SSC已完成确认");
    },
  });
  return {
    canConfirm: canConfirmCurrent,
    canReceive: canReceiveCurrent,
    error: mutation.error,
    isPending: mutation.isPending,
    mutate: mutation.mutate,
    telegramUrl: canReceiveCurrent || canConfirmCurrent ? (telegramLink?.url ?? null) : null,
  };
}

export function OfferStatusBadges({
  draft,
  editing = false,
}: {
  draft: OfferDraftRecord;
  editing?: boolean;
}) {
  const meta = getOfferDraftStatusMeta(draft.status);
  const sscMeta = draft.sscConfirmationStatus
    ? getOfferSscConfirmationMeta(draft.sscConfirmationStatus)
    : null;
  if (editing) {
    const currentMeta = sscMeta ?? meta;
    return <Badge variant={currentMeta.tone}>{currentMeta.label}</Badge>;
  }
  return (
    <>
      {!sscMeta || draft.status !== "draft" ? (
        <Badge variant={meta.tone}>{meta.label}</Badge>
      ) : null}
      {sscMeta ? <Badge variant={sscMeta.tone}>{sscMeta.label}</Badge> : null}
    </>
  );
}

export function OfferSscNotice({ draft, error }: { draft: OfferDraftRecord; error: Error | null }) {
  const pending =
    draft.sscConfirmationStatus === "pending" || draft.sscConfirmationStatus === "confirming";
  return (
    <>
      {pending ? (
        <p className="text-muted-foreground text-xs">
          SSC完成确认后方可发送 Offer 或标记入职。修改 Offer 内容后需重新确认。
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error instanceof Error ? error.message : "SSC确认操作失败"}
        </p>
      ) : null}
    </>
  );
}

export function OfferSscActions({
  confirmation,
  isBusy,
}: {
  confirmation: ReturnType<typeof useOfferSscConfirmation>;
  isBusy: boolean;
}) {
  return (
    <>
      {confirmation.telegramUrl && !isBusy ? (
        <a
          className="mr-auto text-primary text-xs underline-offset-4 hover:underline"
          href={confirmation.telegramUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          在 Telegram 中确认
        </a>
      ) : null}
      {confirmation.canReceive ? (
        <Button disabled={isBusy} onClick={() => confirmation.mutate("receive")} size="sm">
          {confirmation.isPending ? "接收中…" : "SSC接收确认"}
        </Button>
      ) : null}
      {confirmation.canConfirm ? (
        <Button disabled={isBusy} onClick={() => confirmation.mutate("complete")} size="sm">
          {confirmation.isPending ? "确认中…" : "SSC完成确认"}
        </Button>
      ) : null}
    </>
  );
}
