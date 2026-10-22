"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { candidatePrivateTelegramSchema } from "@arc/shared/offer-recruiter-contact";
import type { OfferRecruiterContactState } from "@arc/shared/offer-recruiter-contact";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import {
  getCurrentOfferRecruiterContact,
  getOfferRecruiterContact,
  submitOfferRecruiterContact,
} from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function RecruiterContactIntro() {
  return (
    <div>
      <p className="font-medium text-sm">待招聘人员确认私人 TG</p>
      <p className="mt-1 text-muted-foreground text-xs">
        ODC 已生成 Offer。由简历上传人核对候选人的私人 TG，确认后自动通知 SSC。
      </p>
    </div>
  );
}

function ConfirmedContact({ telegram }: { telegram: string | null | undefined }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <p className="font-medium">招聘人员已确认私人 TG</p>
      <p className="mt-1 text-muted-foreground">候选人私人 TG：{telegram ?? "—"}</p>
    </div>
  );
}

function OfferRecruiterContactEditor({
  candidateId,
  disabled = false,
  onSaved,
  queryKey,
  state,
}: {
  candidateId: string;
  disabled?: boolean;
  onSaved?: () => void | Promise<void>;
  queryKey: readonly (string | number)[];
  state: OfferRecruiterContactState;
}) {
  const slug = useWorkspaceSlug();
  const inputId = useId();
  const queryClient = useQueryClient();
  const [editedTelegram, setEditedTelegram] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const observedCompletion = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["offer-drafts", slug, candidateId] }),
      queryClient.invalidateQueries({ queryKey: ["offer-ssc-state", slug, candidateId] }),
      queryClient.invalidateQueries({ queryKey: ["offer-ssc-telegram-link", slug, candidateId] }),
      onSaved?.(),
    ]);
  }, [candidateId, onSaved, queryClient, slug]);
  const mutation = useMutation({
    mutationFn: (telegram: string) =>
      submitOfferRecruiterContact(slug, candidateId, state.draftId, {
        candidatePrivateTelegram: telegram,
        revision: state.revision,
      }),
    onSuccess: async (updated) => {
      observedCompletion.current = `${updated.draftId}:${updated.revision}`;
      queryClient.setQueryData(queryKey, updated);
      await refresh();
      toast.success("候选人私人 TG 已确认，系统将自动通知 SSC");
    },
  });
  useEffect(() => {
    if (state.status !== "completed") {
      return;
    }
    const key = `${state.draftId}:${state.revision}`;
    if (observedCompletion.current === key) {
      return;
    }
    observedCompletion.current = key;
    void refresh();
  }, [refresh, state.draftId, state.revision, state.status]);
  if (state.status === "completed") {
    return <ConfirmedContact telegram={state.candidatePrivateTelegram} />;
  }
  const value = editedTelegram ?? state.candidatePrivateTelegram ?? "";
  const error =
    validationError ?? (mutation.error instanceof Error ? mutation.error.message : null);
  return (
    <section
      aria-label="招聘人员确认私人 TG"
      className="space-y-3 rounded-md border border-primary/20 bg-muted/20 p-3"
    >
      <RecruiterContactIntro />
      {state.recruiterName ? (
        <p className="text-muted-foreground text-xs">简历上传人：{state.recruiterName}</p>
      ) : null}
      {state.notificationIssue ? (
        <p className="text-amber-700 text-xs dark:text-amber-400">{state.notificationIssue}</p>
      ) : null}
      {state.canConfirm && !disabled ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (mutation.isPending) {
              return;
            }
            const parsed = candidatePrivateTelegramSchema.safeParse(value);
            if (!parsed.success) {
              setValidationError(parsed.error.issues[0]?.message ?? "请填写有效的候选人私人 TG。");
              return;
            }
            setValidationError(null);
            mutation.mutate(parsed.data);
          }}
        >
          <div className="grid gap-1.5 sm:max-w-sm">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Label htmlFor={inputId}>候选人私人 TG（必填）</Label>
              <span className="text-muted-foreground text-xs" id={`${inputId}-hint`}>
                例如：@candidate_name
              </span>
            </div>
            <Input
              aria-describedby={`${inputId}-hint`}
              aria-invalid={Boolean(error)}
              autoComplete="off"
              disabled={mutation.isPending}
              id={inputId}
              maxLength={200}
              onChange={(event) => {
                setEditedTelegram(event.target.value);
                setValidationError(null);
                mutation.reset();
              }}
              value={value}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            可填写 TG 用户名或 t.me 个人链接。已有信息也需核对后确认。
          </p>
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button disabled={mutation.isPending} size="sm" type="submit">
            {mutation.isPending ? "提交中…" : "确认并提交 SSC"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

export function OfferRecruiterContact({
  candidateId,
  disabled = false,
  draft,
  onSaved,
}: {
  candidateId: string;
  disabled?: boolean;
  draft: OfferDraftRecord;
  onSaved: () => void | Promise<void>;
}) {
  const slug = useWorkspaceSlug();
  const pending = draft.recruiterConfirmationStatus === "pending";
  const queryKey = ["offer-recruiter-contact", slug, candidateId, draft.id, draft.sscRevision ?? 1];
  const contact = useQuery({
    enabled: pending && draft.status === "draft" && !disabled,
    queryFn: () => getOfferRecruiterContact(slug, candidateId, draft.id),
    queryKey,
    refetchInterval: pending ? 15_000 : false,
    retry: false,
  });
  if (!draft.recruiterConfirmationStatus) {
    return null;
  }
  if (!pending) {
    return <ConfirmedContact telegram={draft.confirmationInfo?.candidatePrivateTelegram} />;
  }
  if (draft.status !== "draft") {
    return <p className="text-muted-foreground text-xs">本版 Offer 不再提供招聘人员确认操作。</p>;
  }
  if (contact.data) {
    return (
      <OfferRecruiterContactEditor
        candidateId={candidateId}
        disabled={disabled}
        key={`${contact.data.draftId}:${contact.data.revision}`}
        onSaved={onSaved}
        queryKey={queryKey}
        state={contact.data}
      />
    );
  }
  return (
    <section
      aria-label="招聘人员确认私人 TG"
      className="space-y-3 rounded-md border border-primary/20 bg-muted/20 p-3"
    >
      <RecruiterContactIntro />
      {contact.isLoading ? (
        <p className="text-muted-foreground text-xs">正在核对招聘人员信息…</p>
      ) : null}
      {contact.isError ? (
        <div className="space-y-2">
          <p className="text-destructive text-sm" role="alert">
            {contact.error instanceof Error ? contact.error.message : "无法加载招聘人员确认信息。"}
          </p>
          <Button
            disabled={contact.isFetching}
            onClick={() => void contact.refetch()}
            size="sm"
            variant="outline"
          >
            重新加载
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Safe contact-only entry for uploaders who cannot read the Offer tab. */
export function OfferRecruiterContactForUploader({ candidateId }: { candidateId: string }) {
  const slug = useWorkspaceSlug();
  const queryKey = ["offer-recruiter-contact-current", slug, candidateId];
  const contact = useQuery({
    queryFn: () => getCurrentOfferRecruiterContact(slug, candidateId),
    queryKey,
    refetchInterval: 15_000,
    retry: false,
  });
  if (contact.isError || !contact.data?.canConfirm || contact.data.status !== "pending") {
    return null;
  }
  return (
    <OfferRecruiterContactEditor
      candidateId={candidateId}
      key={`${contact.data.draftId}:${contact.data.revision}`}
      queryKey={queryKey}
      state={contact.data}
    />
  );
}
