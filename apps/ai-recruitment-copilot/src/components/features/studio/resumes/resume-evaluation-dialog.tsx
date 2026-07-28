"use client";

import type { PipelineStage } from "@arc/db-schema/studio-interviews";
import type { ResumeEvaluationStatus, ResumeLibraryDetail } from "@arc/shared/studio-resumes";
import { describeResumeEvaluationStatus } from "@arc/shared/studio-resumes";
import {
  IconCircleCheck,
  IconCircleX,
  IconPlus as PlusIcon,
  IconTrash as TrashIcon,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitResumeReviewEvaluation } from "@/lib/client/api";
import { dateTimeLocalInputToISOString } from "@/lib/client/datetime-local";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

interface TimeSlotFormValue {
  endAt: string;
  startAt: string;
}

interface ResumeEvaluationDialogProps {
  decision: ResumeEvaluationStatus | null;
  onDecisionChange: (decision: ResumeEvaluationStatus | null) => void;
  onSubmitted?: (detail: ResumeLibraryDetail) => void;
  recordId: string;
}

const EMPTY_TIME_SLOT: TimeSlotFormValue = { endAt: "", startAt: "" };

/**
 * Floating-bar resume pass/fail actions: page layout only, unassessed, not closed.
 * 仅在独立详情页 + 尚未评估 + 未结案时展示「评估通过 / 不通过」。
 */
export function shouldShowResumeEvaluationActions(input: {
  layoutMode: "modal" | "page";
  pipelineStage?: PipelineStage | null;
  status: ResumeEvaluationStatus | null | undefined;
}) {
  if (input.layoutMode !== "page") {
    return false;
  }
  if (input.pipelineStage === "closed") {
    return false;
  }
  return input.status === null;
}

export function ResumeEvaluationActions({
  disabled = false,
  onDecisionSelect,
}: {
  disabled?: boolean;
  onDecisionSelect: (decision: ResumeEvaluationStatus) => void;
}) {
  return (
    <>
      <Button
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-700 focus-visible:ring-emerald-500/20 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300"
        disabled={disabled}
        onClick={() => onDecisionSelect("pass")}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconCircleCheck className="size-4" />
        评估通过
      </Button>
      <Button
        className="border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 hover:text-rose-700 focus-visible:ring-rose-500/20 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/20 dark:hover:text-rose-300"
        disabled={disabled}
        onClick={() => onDecisionSelect("fail")}
        size="sm"
        type="button"
        variant="outline"
      >
        <IconCircleX className="size-4" />
        评估不通过
      </Button>
    </>
  );
}

export function ResumeEvaluationDialog({
  decision,
  onDecisionChange,
  onSubmitted,
  recordId,
}: ResumeEvaluationDialogProps) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [timeSlots, setTimeSlots] = useState<TimeSlotFormValue[]>([EMPTY_TIME_SLOT]);
  const mutation = useMutation({
    mutationFn: (input: {
      availableTimeSlots?: { endAt: string; startAt: string }[];
      reason: string;
      status: ResumeEvaluationStatus;
    }) => submitResumeReviewEvaluation(slug, recordId, input),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "提交评估失败");
    },
    onSuccess: (detail) => {
      queryClient.setQueriesData(
        { queryKey: ["studio-resumes", slug, "detail", recordId] },
        detail,
      );
      void queryClient.invalidateQueries({ queryKey: ["studio-resumes", slug] });
      toast.success("评估已提交");
      onSubmitted?.(detail);
      onDecisionChange(null);
    },
  });

  useEffect(() => {
    if (decision) {
      setReason("");
      setTimeSlots([EMPTY_TIME_SLOT]);
    }
  }, [decision]);

  function updateTimeSlot(index: number, patch: Partial<TimeSlotFormValue>) {
    setTimeSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? { ...slot, ...patch } : slot)),
    );
  }

  function removeTimeSlot(index: number) {
    setTimeSlots((current) => current.filter((_, slotIndex) => slotIndex !== index));
  }

  function handleSubmitEvaluation() {
    if (!decision) {
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error("请填写评估原因");
      return;
    }
    const availableTimeSlots =
      decision === "pass"
        ? timeSlots.map((slot) => ({
            endAt: dateTimeLocalInputToISOString(slot.endAt),
            startAt: dateTimeLocalInputToISOString(slot.startAt),
          }))
        : [];

    if (decision === "pass") {
      if (availableTimeSlots.length === 0) {
        toast.error("请至少填写 1 段可预约时间");
        return;
      }
      if (availableTimeSlots.some((slot) => !slot.startAt || !slot.endAt)) {
        toast.error("请完整填写可预约时间");
        return;
      }
      if (
        availableTimeSlots.some(
          (slot) => slot.startAt && slot.endAt && new Date(slot.endAt) <= new Date(slot.startAt),
        )
      ) {
        toast.error("结束时间必须晚于开始时间");
        return;
      }
    }

    mutation.mutate({
      availableTimeSlots: availableTimeSlots as { endAt: string; startAt: string }[],
      reason: trimmedReason,
      status: decision,
    });
  }

  return (
    <Dialog onOpenChange={(open) => !open && onDecisionChange(null)} open={decision !== null}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{decision === "pass" ? "评估通过" : "评估不通过"}</DialogTitle>
          <DialogDescription>
            {decision === "pass"
              ? "填写通过原因，并维护候选人可预约的面试时间段。"
              : "填写不通过原因，提交后该结果会进入候选人时间线。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="resume-review-evaluation-reason">原因</Label>
            <Textarea
              id="resume-review-evaluation-reason"
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="请输入评估判断依据"
              rows={4}
              value={reason}
            />
          </div>

          {decision === "pass" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>可预约时间</Label>
                <Button
                  disabled={timeSlots.length >= 10}
                  onClick={() => setTimeSlots((current) => [...current, EMPTY_TIME_SLOT])}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PlusIcon className="size-4" />
                  添加时间
                </Button>
              </div>
              <div className="space-y-2">
                {timeSlots.map((slot, index) => (
                  <div
                    className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                    key={index}
                  >
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor={`slot-start-${index}`}>
                        开始时间
                      </Label>
                      <DateTimePicker
                        id={`slot-start-${index}`}
                        onValueChange={(startAt) => updateTimeSlot(index, { startAt })}
                        placeholder="选择开始时间"
                        value={slot.startAt}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-xs" htmlFor={`slot-end-${index}`}>
                        结束时间
                      </Label>
                      <DateTimePicker
                        id={`slot-end-${index}`}
                        onValueChange={(endAt) => updateTimeSlot(index, { endAt })}
                        placeholder="选择结束时间"
                        value={slot.endAt}
                      />
                    </div>
                    <Button
                      aria-label="删除时间段"
                      disabled={timeSlots.length <= 1}
                      onClick={() => removeTimeSlot(index)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={() => onDecisionChange(null)} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={mutation.isPending} onClick={handleSubmitEvaluation} type="button">
            提交评估
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResumeReviewEvaluationBar({
  isLoading,
  recordId,
  status,
}: {
  isLoading: boolean;
  recordId: string;
  status: ResumeEvaluationStatus | null | undefined;
}) {
  const [decision, setDecision] = useState<ResumeEvaluationStatus | null>(null);
  const hasSubmittedEvaluation = status !== null && status !== undefined;

  if (hasSubmittedEvaluation) {
    const meta = describeResumeEvaluationStatus(status);
    return (
      <div className="fixed right-0 bottom-0 left-0 z-20 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
          <span className="text-muted-foreground">评估结果</span>
          <Badge variant={meta.tone}>{meta.label}</Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed right-0 bottom-0 left-0 z-20 border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
      <ButtonGroup
        aria-label="简历评估"
        className="mx-auto w-full max-w-md [&>*]:min-w-0 [&>*]:flex-1"
      >
        <ResumeEvaluationActions disabled={isLoading} onDecisionSelect={setDecision} />
      </ButtonGroup>
      <ResumeEvaluationDialog
        decision={decision}
        onDecisionChange={setDecision}
        recordId={recordId}
      />
    </div>
  );
}
