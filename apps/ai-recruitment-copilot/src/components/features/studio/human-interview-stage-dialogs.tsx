"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { humanInterviewRoundOutcomeMeta } from "@arc/db-schema/studio-interviews";
import type { HumanInterviewRoundOutcome } from "@arc/db-schema/studio-interviews";
import type { HumanInterviewRoundRecord } from "@arc/shared/studio-pipeline-stages";
import type { ResumeAvailableTimeSlot } from "@arc/shared/studio-resumes";
import { dateTimeLocalInputToISOString } from "@/lib/client/datetime-local";
import {
  cancelHumanInterviewRound,
  completeHumanInterviewRound,
  createHumanInterviewMeeting,
  createHumanInterviewRound,
  patchHumanInterviewRound,
} from "@/lib/client/api";
import {
  humanInterviewKeys,
  invalidateHumanInterviewCandidateQueries,
} from "@/lib/client/api/query-keys";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { DateTimePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Textarea } from "@/components/ui/textarea";
import { addOneHourToDateTimeLocalInputValue } from "./human-interview-stage-utils";
import { HumanInterviewAvailableTimeSlots } from "./human-interview-available-time-slots";
import { HumanInterviewTimeZonePreview } from "./human-interview-time-zone-preview";
import { useWorkspaceInterviewerMembers } from "./use-workspace-interviewer-members";
import { useHumanInterviewScheduleConfirmation } from "./use-human-interview-schedule-confirmation";

const EMPTY_INTERVIEWER_IDS: string[] = [];
const EMPTY_AVAILABLE_TIME_SLOTS: ResumeAvailableTimeSlot[] = [];

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  existingCount: number;
  availableTimeSlots?: ResumeAvailableTimeSlot[];
  defaultInterviewerIds?: string[];
  onScheduled: () => void;
}

// 预设轮次标签：第 N 轮根据现有数量推荐，HR 可以自定义。
// Preset round labels picked from existing count; HR can override.
function defaultRoundLabel(existingCount: number): string {
  const labels = ["技术复面", "HR 复面", "总监终面", "跨部门面"];
  return labels[existingCount] ?? `第 ${existingCount + 1} 轮`;
}

export function ScheduleRoundDialog({
  open,
  onOpenChange,
  candidateId,
  existingCount,
  availableTimeSlots = EMPTY_AVAILABLE_TIME_SLOTS,
  defaultInterviewerIds = EMPTY_INTERVIEWER_IDS,
  onScheduled,
}: ScheduleDialogProps) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const { data: members = [] } = useWorkspaceInterviewerMembers(open);
  const { confirmSchedule, conflictDialog } = useHumanInterviewScheduleConfirmation();
  const [label, setLabel] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setInterviewerIds([...defaultInterviewerIds]);
    }
  }, [defaultInterviewerIds, open]);

  function reset() {
    setLabel("");
    setScheduledAt("");
    setValidUntil("");
    setInterviewerIds([]);
    setNotes("");
  }

  function handleScheduledAtChange(value: string) {
    setScheduledAt(value);
    if (!validUntil) {
      setValidUntil(addOneHourToDateTimeLocalInputValue(value));
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const roundLabel = label.trim() || defaultRoundLabel(existingCount);
      const scheduledAtIso = dateTimeLocalInputToISOString(scheduledAt);
      if (!scheduledAtIso) {
        throw new Error("请填写面试时间");
      }
      const validUntilIso = dateTimeLocalInputToISOString(validUntil);
      if (
        !(await confirmSchedule({
          interviewerIds,
          scheduledAt: scheduledAtIso,
          validUntil: validUntilIso,
        }))
      ) {
        return null;
      }
      const round = await createHumanInterviewRound(slug, candidateId, {
        format: "online",
        interviewerIds,
        label: roundLabel,
        location: null,
        meetingUrl: null,
        notes: notes.trim() || null,
        scheduledAt: scheduledAtIso,
      });
      await createHumanInterviewMeeting(slug, {
        interviewerIds,
        notes: notes.trim() || null,
        roundIds: [round.id],
        scheduledAt: scheduledAtIso,
        title: roundLabel,
        validUntil: validUntilIso,
      });
      return round;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "创建失败"),
    onSuccess: (round) => {
      if (!round) {
        return;
      }
      toast.success("已安排线上真人复面");
      void invalidateHumanInterviewCandidateQueries(queryClient, { candidateId, slug });
      onScheduled();
      handleOpenChange(false);
    },
  });
  const memberOptions = members.map((m) => ({
    label: m.name,
    value: m.id,
  }));

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!mutation.isPending) {
          handleOpenChange(next);
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>安排真人复面</DialogTitle>
          <DialogDescription>
            填好基础信息后保存。系统会创建线上复面会议；有效时间为空时默认到面试时间后一小时。
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-4 py-2" disabled={mutation.isPending}>
          <HumanInterviewAvailableTimeSlots
            slots={availableTimeSlots}
            title="候选人可接受的预约时间"
          />

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="round-label">
              轮次标签
            </Label>
            <Input
              id="round-label"
              maxLength={50}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={defaultRoundLabel(existingCount)}
              value={label}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="scheduled-at">
              面试时间
            </Label>
            <DateTimePicker
              id="scheduled-at"
              onValueChange={handleScheduledAtChange}
              required
              value={scheduledAt}
            />
            <p className="text-muted-foreground text-xs">以中国标准时间（UTC+8）设置。</p>
            <HumanInterviewTimeZonePreview label="面试时间换算" value={scheduledAt} />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="valid-until">
              有效时间至（中国标准时间）
            </Label>
            <DateTimePicker id="valid-until" onValueChange={setValidUntil} value={validUntil} />
            <HumanInterviewTimeZonePreview label="有效时间换算" value={validUntil} />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm">面试官</Label>
            <SearchableMultiSelect
              emptyMessage="找不到匹配的成员"
              onChange={setInterviewerIds}
              options={memberOptions}
              placeholder="选择面试官（可多选）"
              searchPlaceholder="搜索成员…"
              selectedFormat={(count) => `已选 ${count} 位面试官`}
              selectedPreviewLimit={2}
              value={interviewerIds}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="round-notes">
              备注（可选）
            </Label>
            <Textarea
              id="round-notes"
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="给自己看的提示，如重点考察方向"
              rows={2}
              value={notes}
            />
          </div>
        </fieldset>

        <DialogFooter>
          <Button
            disabled={mutation.isPending}
            onClick={() => handleOpenChange(false)}
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={mutation.isPending || interviewerIds.length === 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
      {conflictDialog}
    </Dialog>
  );
}

// ── 面试评价 dialog ──
// Complete-round dialog.

interface CompleteDialogProps {
  round: HumanInterviewRoundRecord | null;
  candidateId: string;
  onOpenChange: (open: boolean) => void;
  onRejected?: () => void;
}

export function CompleteRoundDialog({
  round,
  candidateId,
  onOpenChange,
  onRejected,
}: CompleteDialogProps) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<HumanInterviewRoundOutcome>("pass");
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!round) {
      return;
    }
    setOutcome(round.outcome ?? "pass");
    setScore(round.score === null ? "" : String(round.score));
    setFeedback(round.feedback ?? "");
  }, [round]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setOutcome("pass");
      setScore("");
      setFeedback("");
    }
    onOpenChange(next);
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!round) {
        throw new Error("missing round");
      }
      const parsedScore = score === "" ? null : Number(score);
      if (
        parsedScore !== null &&
        (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100)
      ) {
        throw new Error("评分需为 0-100 的数字");
      }
      const trimmedFeedback = feedback.trim();
      if (!trimmedFeedback) {
        throw new Error("请填写面试评价");
      }
      const input = {
        feedback: trimmedFeedback,
        outcome,
        score: parsedScore,
      };
      return round.status === "completed"
        ? patchHumanInterviewRound(slug, candidateId, round.id, input)
        : completeHumanInterviewRound(slug, candidateId, round.id, input);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "面试评价失败"),
    onSuccess: async (updatedRound) => {
      const becameRejected =
        updatedRound.outcome === "fail" &&
        (round?.status !== "completed" || round.outcome !== "fail");
      queryClient.setQueryData<HumanInterviewRoundRecord[]>(
        humanInterviewKeys.rounds(slug, candidateId),
        (current) =>
          current?.map((item) => (item.id === updatedRound.id ? updatedRound : item)) ?? current,
      );
      await invalidateHumanInterviewCandidateQueries(queryClient, { candidateId, slug });
      toast.success(round?.status === "completed" ? "评价已更新" : "已面试评价");
      handleOpenChange(false);
      if (becameRejected) {
        onRejected?.();
      }
    },
  });
  let submitLabel = "确认完成";
  if (mutation.isPending) {
    submitLabel = "保存中…";
  } else if (round?.status === "completed") {
    submitLabel = "保存修改";
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={round !== null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {round?.status === "completed" ? "编辑评价" : "面试评价"}：{round?.label}
          </DialogTitle>
          <DialogDescription>
            {round?.status === "completed"
              ? "修改面试结果、评分和反馈。保存后系统会重新判断是否可以进入 Offer。"
              : "录入面试结果。完成后会自动结束该轮次下的会议。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-1.5">
            <Label className="text-sm">结果</Label>
            <RadioGroup
              className="grid grid-cols-3 gap-2"
              onValueChange={(v) => setOutcome(v as HumanInterviewRoundOutcome)}
              value={outcome}
            >
              {(Object.keys(humanInterviewRoundOutcomeMeta) as HumanInterviewRoundOutcome[]).map(
                (v) => (
                  <div className="flex items-center gap-2" key={v}>
                    <RadioGroupItem id={`outcome-${v}`} value={v} />
                    <Label className="cursor-pointer text-sm" htmlFor={`outcome-${v}`}>
                      {humanInterviewRoundOutcomeMeta[v].label}
                    </Label>
                  </div>
                ),
              )}
            </RadioGroup>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="round-score">
              评分（0-100，可选）
            </Label>
            <Input
              id="round-score"
              inputMode="numeric"
              max={100}
              min={0}
              onChange={(e) => setScore(e.target.value)}
              type="number"
              value={score}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="round-feedback">
              反馈
            </Label>
            <Textarea
              id="round-feedback"
              maxLength={5000}
              onChange={(e) => setFeedback(e.target.value)}
              required
              placeholder="对候选人的评价、亮点、不足……"
              rows={4}
              value={feedback}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={mutation.isPending}
            onClick={() => handleOpenChange(false)}
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 取消 dialog ──
// Cancel-round dialog.

interface CancelDialogProps {
  round: HumanInterviewRoundRecord | null;
  candidateId: string;
  onOpenChange: (open: boolean) => void;
  onCancelled: () => void;
}

export function CancelRoundDialog({
  round,
  candidateId,
  onOpenChange,
  onCancelled,
}: CancelDialogProps) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason("");
    }
    onOpenChange(next);
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!round) {
        throw new Error("missing round");
      }
      return cancelHumanInterviewRound(slug, candidateId, round.id, {
        reason: reason.trim() || null,
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "取消失败"),
    onSuccess: () => {
      toast.success("已取消该轮");
      void invalidateHumanInterviewCandidateQueries(queryClient, { candidateId, slug });
      onCancelled();
      handleOpenChange(false);
    },
  });

  return (
    <Dialog onOpenChange={handleOpenChange} open={round !== null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>取消轮次：{round?.label}</DialogTitle>
          <DialogDescription>
            取消后该轮不会算入复面统计，关联的视频会议也会一并删除；如想保留为「已完成」请改走「面试评价」流程。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5 py-2">
          <Label className="text-sm" htmlFor="cancel-reason">
            取消原因（可选）
          </Label>
          <Textarea
            id="cancel-reason"
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：候选人临时有事；面试官请假"
            rows={3}
            value={reason}
          />
        </div>

        <DialogFooter>
          <Button
            disabled={mutation.isPending}
            onClick={() => handleOpenChange(false)}
            variant="outline"
          >
            返回
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            variant="destructive"
          >
            {mutation.isPending ? "处理中…" : "确认取消"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
