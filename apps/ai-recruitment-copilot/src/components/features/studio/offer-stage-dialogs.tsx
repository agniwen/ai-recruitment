"use client";

import { IconArrowUpRight } from "@tabler/icons-react";
/* oxlint-disable no-use-before-define -- helper components defined below export component for top-down readability */
// Offer 阶段的详情面板内容：
//   - 顶部：候选人期望（薪资 / 现 base / 期望入职日）—— 可编辑，partial merge
//   - 下方：Offer 草稿版本时间线（version desc）
//   - 新建 Offer / 编辑 draft / 发送 / 记录响应 / 撤回
//   - 候选人接受 Offer 时弹二次确认，请上层走「标记结案 hired」流程
//
// Offer-stage panel: candidate expectations inline form + offer draft
// timeline. Draft → sent → respond / cancel flows; on "accepted" we prompt
// the caller to launch the close flow.

import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { OfferDraftInput } from "@arc/db-schema/studio-interviews";
import type { OfferCreationContext } from "@arc/shared/offer-confirmation";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import {
  createOfferDraft,
  getOfferCreationContext,
  patchOfferDraft,
  respondOfferDraft,
} from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  OfferDraftFormFields,
  buildOfferDraftPayload,
  createBlankOfferFormState,
  createOfferFormFieldSetter,
  offerFormStateFromDraft,
  offerResponseLabel,
  saveSuccessMessage,
} from "./offer-stage-form";
import type { OfferFormState } from "./offer-stage-form";
import { OfferCreationReview } from "./offer-creation-confirmation";

interface OfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  candidateEmail: string | null;
  mode: "create" | "edit";
  existingDraft?: OfferDraftRecord | null;
  onSaved: () => void;
}

function getOfferDialogLabels({
  mode,
  confirmingCreation,
  isPending,
  loadingContext,
}: {
  mode: OfferDialogProps["mode"];
  confirmingCreation: boolean;
  isPending: boolean;
  loadingContext: boolean;
}) {
  let dialogTitle = "新建 Offer";
  if (mode === "edit") {
    dialogTitle = "编辑 Offer 草稿";
  } else if (confirmingCreation) {
    dialogTitle = "确认 Offer 信息";
  }
  let primaryText = mode === "edit" ? "保存" : "下一步：确认信息";
  if (isPending) {
    primaryText = mode === "create" ? "创建中…" : "保存中…";
  } else if (loadingContext) {
    primaryText = "加载确认信息…";
  } else if (confirmingCreation) {
    primaryText = "确认创建";
  }
  return { dialogTitle, primaryText };
}

export function CreateOrEditOfferDialog({
  open,
  onOpenChange,
  candidateId,
  candidateEmail: _candidateEmail,
  mode,
  existingDraft,
  onSaved,
}: OfferDialogProps) {
  const slug = useWorkspaceSlug();
  const [form, setForm] = useState<OfferFormState>(() => createBlankOfferFormState());
  const setFormField = createOfferFormFieldSetter(setForm);
  const [context, setContext] = useState<OfferCreationContext | null>(null);
  const [step, setStep] = useState<"terms" | "confirmation">("terms");
  const [loadingContext, setLoadingContext] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const session = useRef(0);
  const submitting = useRef(false);
  const contextLoading = useRef(false);

  const loadContext = useCallback(
    async (sessionId: number) => {
      if (contextLoading.current) {
        return;
      }
      contextLoading.current = true;
      setLoadingContext(true);
      setErrorMessage(null);
      try {
        const loaded = await getOfferCreationContext(slug, candidateId);
        if (session.current !== sessionId) {
          return;
        }
        setContext(loaded);
        setForm((current) => ({
          ...current,
          confirmationInfo: current.confirmationInfo ?? loaded.defaults,
        }));
      } catch (error) {
        if (session.current === sessionId) {
          setErrorMessage(error instanceof Error ? error.message : "加载 Offer 确认信息失败");
        }
      } finally {
        if (session.current === sessionId) {
          contextLoading.current = false;
          setLoadingContext(false);
        }
      }
    },
    [slug, candidateId],
  );

  const mutation = useMutation({
    mutationFn: ({
      payload,
      targetSlug,
      targetCandidateId,
      draftId,
    }: {
      payload: OfferDraftInput;
      sessionId: number;
      targetSlug: string;
      targetCandidateId: string;
      draftId: string | null;
    }) => {
      if (draftId) {
        return patchOfferDraft(targetSlug, targetCandidateId, draftId, payload);
      }
      return createOfferDraft(targetSlug, targetCandidateId, {
        ...payload,
        sendImmediately: false,
      });
    },
    onError: (error, variables) => {
      if (variables.sessionId !== session.current) {
        return;
      }
      const message = error instanceof Error ? error.message : "保存失败";
      setErrorMessage(message);
      toast.error(message);
    },
    onSuccess: (_saved, variables) => {
      if (variables.sessionId !== session.current) {
        return;
      }
      toast.success(saveSuccessMessage(variables.draftId ? "edit" : "create", false));
      onSaved();
      onOpenChange(false);
    },
  });

  useEffect(() => {
    session.current += 1;
    submitting.current = false;
    contextLoading.current = false;
    setContext(null);
    setStep("terms");
    setErrorMessage(null);
    setLoadingContext(false);
    if (open) {
      if (mode === "edit" && existingDraft) {
        setForm(offerFormStateFromDraft(existingDraft));
      } else {
        setForm(createBlankOfferFormState());
        void loadContext(session.current);
      }
    }
    return () => {
      session.current += 1;
    };
  }, [open, mode, existingDraft, candidateId, slug, loadContext]);

  function changeOpen(next: boolean) {
    if (submitting.current) {
      return;
    }
    if (!next) {
      session.current += 1;
      contextLoading.current = false;
    }
    onOpenChange(next);
  }

  function showConfirmation() {
    if (contextLoading.current || submitting.current || !context) {
      return;
    }
    setErrorMessage(null);
    try {
      buildOfferDraftPayload(form);
      setStep("confirmation");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "请检查 Offer 信息");
    }
  }

  async function save() {
    if (submitting.current || contextLoading.current) {
      return;
    }
    const sessionId = session.current;
    try {
      const payload = buildOfferDraftPayload(form);
      submitting.current = true;
      setErrorMessage(null);
      await mutation.mutateAsync({
        draftId: mode === "edit" ? (existingDraft?.id ?? null) : null,
        payload,
        sessionId,
        targetCandidateId: candidateId,
        targetSlug: slug,
      });
    } catch (error) {
      if (session.current === sessionId) {
        setErrorMessage(error instanceof Error ? error.message : "保存失败");
      }
    } finally {
      if (session.current === sessionId) {
        submitting.current = false;
      }
    }
  }
  const confirmingCreation = mode === "create" && step === "confirmation" && form.confirmationInfo;
  const contextUnavailable = mode === "create" && !context;
  const resumeUrl = `/api/w/${encodeURIComponent(slug)}/studio/resumes/${encodeURIComponent(candidateId)}/resume`;
  const { dialogTitle, primaryText } = getOfferDialogLabels({
    confirmingCreation: Boolean(confirmingCreation),
    isPending: mutation.isPending,
    loadingContext,
    mode,
  });

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent
        showCloseButton={!mutation.isPending}
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "草稿状态可编辑，修改后需重新完成 SSC 确认。"
              : "先填写完整 Offer 信息，下一步核对后确认创建。"}
          </DialogDescription>
          {mode === "create" ? (
            <p className="text-muted-foreground text-xs">
              新增后等待 SSC 接收并完成确认；确认完成前不可发送 Offer 或标记入职。
            </p>
          ) : null}
        </DialogHeader>

        {confirmingCreation ? (
          <OfferCreationReview
            info={confirmingCreation}
            position={form.position}
            baseSalary={Number(form.baseSalary)}
            currency={form.currency}
            resume={context?.resume}
            resumeUrl={resumeUrl}
            expiresAt={form.expiresAt}
            disabled={mutation.isPending}
          />
        ) : (
          <>
            {loadingContext ? (
              <output className="text-muted-foreground text-sm">正在加载候选人资料…</output>
            ) : null}
            <OfferDraftFormFields
              form={form}
              idPrefix="offer"
              onFieldChange={setFormField}
              context={context}
              disabled={mutation.isPending || contextUnavailable || loadingContext}
            />
          </>
        )}
        {errorMessage ? (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage}
          </p>
        ) : null}
        {contextUnavailable && !loadingContext && errorMessage ? (
          <Button
            variant="outline"
            onClick={() => {
              void loadContext(session.current);
            }}
          >
            重新加载资料
          </Button>
        ) : null}

        <DialogFooter>
          <Button disabled={mutation.isPending} onClick={() => changeOpen(false)} variant="outline">
            取消
          </Button>
          {confirmingCreation ? (
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                setErrorMessage(null);
                setStep("terms");
              }}
              variant="outline"
            >
              返回修改
            </Button>
          ) : null}
          <Button
            disabled={
              mutation.isPending ||
              loadingContext ||
              contextUnavailable ||
              !form.position.trim() ||
              !form.baseSalary
            }
            onClick={() => {
              void (confirmingCreation || mode === "edit" ? save() : showConfirmation());
            }}
          >
            {primaryText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 记录响应 dialog ──
// Record-response dialog.

interface RespondDialogProps {
  draft: OfferDraftRecord | null;
  candidateId: string;
  onOpenChange: (open: boolean) => void;
  onResponded: () => void;
  onAccepted: (draft: OfferDraftRecord) => void;
}

export function RespondOfferDialog({
  draft,
  candidateId,
  onOpenChange,
  onResponded,
  onAccepted,
}: RespondDialogProps) {
  const slug = useWorkspaceSlug();
  const [response, setResponse] = useState<"accepted" | "declined" | "counter">("accepted");
  const [counter, setCounter] = useState("");

  useEffect(() => {
    if (draft) {
      setResponse("accepted");
      setCounter("");
    }
  }, [draft]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!draft) {
        throw new Error("missing draft");
      }
      return respondOfferDraft(slug, candidateId, draft.id, {
        candidateCounter: response === "counter" ? counter.trim() || null : null,
        response,
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "记录失败"),
    onSuccess: (updated) => {
      onResponded();
      if (updated.status === "accepted") {
        // 接受 Offer：让上层弹「标记结案 + outcome=hired」二次确认。
        // Accepted: nudge caller to launch the close-as-hired flow.
        onAccepted(updated);
      } else {
        toast.success(response === "declined" ? "已记录为拒绝" : "已记录候选人议价");
      }
      onOpenChange(false);
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={draft !== null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>记录候选人响应</DialogTitle>
          <DialogDescription>
            候选人接受 → 建议结案为「已到岗」；候选人议价 → 当前版本保持已发出，后续新建版本响应。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup
            className="grid gap-2"
            onValueChange={(v) => setResponse(v as typeof response)}
            value={response}
          >
            {(["accepted", "declined", "counter"] as const).map((value) => (
              <div className="flex items-center gap-2" key={value}>
                <RadioGroupItem id={`resp-${value}`} value={value} />
                <Label className="cursor-pointer text-sm" htmlFor={`resp-${value}`}>
                  {offerResponseLabel(value)}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {response === "counter" ? (
            <div className="grid gap-1.5">
              <Label className="text-sm" htmlFor="counter-content">
                议价内容
              </Label>
              <Textarea
                id="counter-content"
                maxLength={2000}
                onChange={(e) => setCounter(e.target.value)}
                placeholder="例如：希望月薪提高到 35k，或希望追加 0.05% 期权"
                rows={3}
                value={counter}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "保存中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 接受 Offer 二次确认 dialog ──
// "Just accepted → mark as hired?" confirmation.

export function AcceptedConfirmDialog({
  draft,
  onOpenChange,
  onProceed,
}: {
  draft: OfferDraftRecord | null;
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
}) {
  const sscPending =
    draft?.sscConfirmationStatus === "pending" || draft?.sscConfirmationStatus === "confirming";
  return (
    <Dialog onOpenChange={onOpenChange} open={draft !== null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>候选人已接受 Offer</DialogTitle>
          <DialogDescription>
            {sscPending
              ? "SSC完成确认后方可标记为「已到岗」。请先完成当前版本的 SSC 确认。"
              : "是否立刻标记为「已到岗」并结案？你也可以稍后在 action bar 里手动标记。"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            稍后
          </Button>
          <Button disabled={sscPending} onClick={onProceed}>
            <IconArrowUpRight className="size-4" />
            标记为已到岗
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
