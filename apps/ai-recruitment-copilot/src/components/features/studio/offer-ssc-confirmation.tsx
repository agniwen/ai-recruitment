"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
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
import { OfferSscCompleteDialog } from "./offer-ssc-complete-dialog";

type OfferSscAction = { action: "receive" } | { action: "complete"; file: File | null };

function getOfferSscActionState(draft: OfferDraftRecord, canReceive: boolean, canConfirm: boolean) {
  const status = draft.sscConfirmationStatus ?? null;
  const recruiterPending = draft.recruiterConfirmationStatus === "pending";
  let receiveDisabledReason: string | null = null;
  let confirmDisabledReason: string | null = null;
  if (!canReceive) {
    receiveDisabledReason = "当前账号无SSC接收确认权限";
  } else if (status !== "pending") {
    receiveDisabledReason = "SSC已接收确认";
  }
  if (!canConfirm) {
    confirmDisabledReason = "当前账号无SSC完成确认权限";
  } else if (status === "pending") {
    confirmDisabledReason = "请先完成SSC接收确认";
  }
  return {
    canConfirm:
      !recruiterPending && canConfirm && status === "confirming" && draft.status === "draft",
    canReceive: !recruiterPending && canReceive && status === "pending" && draft.status === "draft",
    confirmDisabledReason,
    receiveDisabledReason,
    showActions: !recruiterPending && draft.status === "draft" && status !== null,
    status,
  };
}

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
  const actions = getOfferSscActionState(draft, canReceive, canConfirm);
  const { data: telegramLink } = useQuery({
    enabled: !disabled && (actions.canReceive || actions.canConfirm),
    queryFn: () => getOfferSscTelegramLink(slug, candidateId, draft.id),
    queryKey: ["offer-ssc-telegram-link", slug, candidateId, draft.id],
  });
  const mutation = useMutation({
    mutationFn: (inputAction: OfferSscAction) => {
      const input = { revision: draft.sscRevision ?? 1 };
      return inputAction.action === "receive"
        ? receiveOfferSscConfirmation(slug, candidateId, draft.id, input)
        : completeOfferSscConfirmation(
            slug,
            candidateId,
            draft.id,
            { ...input, internalApprovalConfirmed: true },
            inputAction.file,
          );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "SSC确认操作失败"),
    onSuccess: async (_updated, { action }) => {
      await onSaved();
      toast.success(action === "receive" ? "SSC已接收，当前 Offer 确认中" : "SSC已完成确认");
    },
  });
  return {
    ...actions,
    canConfirm: !disabled && actions.canConfirm,
    canReceive: !disabled && actions.canReceive,
    complete: (file: File | null) => {
      if (disabled || !actions.canConfirm || mutation.isPending) {
        return Promise.reject(new Error("当前 Offer 无法完成 SSC 确认，请刷新后重试。"));
      }
      return mutation.mutateAsync({ action: "complete", file });
    },
    contextKey: JSON.stringify([
      slug,
      candidateId,
      draft.id,
      draft.version,
      draft.sscRevision ?? 1,
      draft.status,
      draft.recruiterConfirmationStatus,
      actions.status,
      canConfirm,
      Boolean(disabled),
    ]),
    error: mutation.error,
    isPending: mutation.isPending,
    pendingAction: mutation.isPending ? mutation.variables?.action : null,
    receive: () => {
      if (!disabled && actions.canReceive && !mutation.isPending) {
        mutation.mutate({ action: "receive" });
      }
    },
    showActions: !disabled && actions.showActions,
    telegramUrl:
      !disabled && (actions.canReceive || actions.canConfirm) ? (telegramLink?.url ?? null) : null,
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
  if (draft.recruiterConfirmationStatus === "pending" && draft.status === "draft") {
    return <Badge variant="outline">待招聘人员确认私人 TG</Badge>;
  }
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
      {pending && draft.recruiterConfirmationStatus !== "pending" ? (
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
  const id = useId();
  const [openContext, setOpenContext] = useState<string | null>(null);
  useEffect(() => {
    setOpenContext(null);
  }, [confirmation.contextKey]);
  if (!confirmation.showActions) {
    return null;
  }
  if (confirmation.status === "completed") {
    return <p className="text-muted-foreground text-xs">SSC确认已完成</p>;
  }
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
      <div className="flex flex-col items-end gap-1">
        <Button
          aria-describedby={confirmation.receiveDisabledReason ? `${id}-receive-reason` : undefined}
          disabled={isBusy || !confirmation.canReceive}
          onClick={confirmation.receive}
          size="sm"
        >
          {confirmation.pendingAction === "receive" ? "接收中…" : "SSC接收确认"}
        </Button>
        {confirmation.receiveDisabledReason ? (
          <p className="text-muted-foreground text-xs" id={`${id}-receive-reason`}>
            {confirmation.receiveDisabledReason}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button
          aria-describedby={confirmation.confirmDisabledReason ? `${id}-confirm-reason` : undefined}
          disabled={isBusy || !confirmation.canConfirm}
          onClick={() => setOpenContext(confirmation.contextKey)}
          size="sm"
        >
          {confirmation.pendingAction === "complete" ? "确认中…" : "SSC完成确认"}
        </Button>
        {confirmation.confirmDisabledReason ? (
          <p className="text-muted-foreground text-xs" id={`${id}-confirm-reason`}>
            {confirmation.confirmDisabledReason}
          </p>
        ) : null}
      </div>
      {openContext === confirmation.contextKey && confirmation.canConfirm ? (
        <OfferSscCompleteDialog
          key={confirmation.contextKey}
          onClose={() => setOpenContext(null)}
          onConfirm={confirmation.complete}
        />
      ) : null}
    </>
  );
}
