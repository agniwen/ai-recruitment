"use client";

/* oxlint-disable no-use-before-define -- helper components defined below export */
// 「标记结案」/「重新激活」二合一对话框。
//   - mode='close'：HR 选 outcome（到岗/淘汰/撤回/归档）+ 可选的到岗 / 淘汰细节
//   - mode='reactivate'：HR 填写原因并恢复到简历初筛
// 调用方只传 id 与 candidateName 即可。
//
// Close & reactivate combined dialog. In close mode HR picks an outcome and
// fills outcome-specific details. In reactivate mode HR enters a reason and
// restores the candidate to resume screening.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  candidateOutcomeMeta,
  closeCategoryMeta,
  closeCategoryValues,
} from "@arc/db-schema/studio-interviews";
import type { CandidateOutcome, ClosedMeta, CloseCategory } from "@arc/db-schema/studio-interviews";
import type { ApiError } from "@/lib/client/api/errors";
import { transitionInterviewRecord } from "@/lib/client/api";
import { runAsyncAction } from "@/lib/client/async-control";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { DatePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// 结案可选的 4 个终态——in_pipeline 在 close 流程里不合法。
// The four terminal outcomes available when closing.
const CLOSE_OUTCOMES: Exclude<CandidateOutcome, "in_pipeline">[] = [
  "hired",
  "rejected",
  "withdrawn",
  "archived",
];

const REACTIVATE_TARGET_STAGE = "screening" as const;
const REACTIVATE_TARGET_STAGE_LABEL = "简历初筛";

interface TransitionCandidateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "close" | "reactivate";
  candidate: { id: string; candidateName: string | null } | null;
  // close 模式可以预设 outcome（例如 Offer 接受后弹「标记到岗」）。
  // Pre-select an outcome in close mode (e.g., from offer accept flow).
  initialOutcome?: Exclude<CandidateOutcome, "in_pipeline">;
  onCompleted: () => void;
}

export function TransitionCandidateDialog(props: TransitionCandidateDialogProps) {
  const { open, mode, candidate } = props;
  if (mode === "reactivate") {
    return <ReactivateDialog {...props} candidate={candidate} open={open} />;
  }
  return <CloseDialog {...props} candidate={candidate} open={open} />;
}

// ── Close 模式 ──
// Close mode.

function CloseDialog({
  open,
  onOpenChange,
  candidate,
  initialOutcome,
  onCompleted,
}: Omit<TransitionCandidateDialogProps, "mode">) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();

  const [outcome, setOutcome] = useState<Exclude<CandidateOutcome, "in_pipeline">>(
    initialOutcome ?? "rejected",
  );
  const [internalNotes, setInternalNotes] = useState("");
  const [feedbackToCandidate, setFeedbackToCandidate] = useState("");
  // 到岗细节
  const [joiningDate, setJoiningDate] = useState("");
  const [joiningDepartment, setJoiningDepartment] = useState("");
  const [joiningPosition, setJoiningPosition] = useState("");
  const [telegram, setTelegram] = useState("");
  const [alias, setAlias] = useState("");
  // 淘汰细节
  const [category, setCategory] = useState<CloseCategory | "">("");
  const [revisitAfter, setRevisitAfter] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 打开对话框时根据 initialOutcome 重置表单。
  // Reset form state whenever the dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    setOutcome(initialOutcome ?? "rejected");
    setInternalNotes("");
    setFeedbackToCandidate("");
    setJoiningDate("");
    setJoiningDepartment("");
    setJoiningPosition("");
    setTelegram("");
    setAlias("");
    setCategory("");
    setRevisitAfter("");
  }, [open, initialOutcome]);

  async function handleConfirm() {
    if (!candidate) {
      return;
    }
    setSubmitting(true);
    await runAsyncAction({
      cleanup: () => setSubmitting(false),
      onError: (error) => {
        const message =
          (error as ApiError | undefined)?.message ??
          (error instanceof Error ? error.message : "操作失败");
        toast.error(message);
      },
      operation: async () => {
        // 构造 closedMeta partial。Build the closedMeta partial.
        const closedMeta: Omit<ClosedMeta, "previousStage"> = {
          feedbackToCandidate: feedbackToCandidate.trim() || null,
          internalNotes: internalNotes.trim() || null,
        };
        if (outcome === "hired") {
          closedMeta.hiredDetails = {
            alias: alias.trim() || null,
            joiningDate: joiningDate || null,
            joiningDepartment: joiningDepartment.trim() || null,
            joiningPosition: joiningPosition.trim() || null,
            telegram: telegram.trim() || null,
          };
        }
        if (outcome === "rejected") {
          closedMeta.category = category || null;
          closedMeta.rejectionDetails = {
            revisitAfter: revisitAfter || null,
          };
        }

        await transitionInterviewRecord(slug, candidate.id, {
          closedMeta,
          outcome,
          pipelineStage: "closed",
        });
        toast.success(`已标记为「${candidateOutcomeMeta[outcome].label}」`);
        // 详情面板缓存也刷一下，让 action bar 立刻显示「重新激活」。
        // Invalidate detail cache so the action bar swaps to "reactivate".
        await queryClient.invalidateQueries({
          queryKey: ["studio-resumes", slug, "detail", candidate.id],
        });
        onCompleted();
        onOpenChange(false);
      },
    });
  }

  const candidateLabel = candidate?.candidateName || "该候选人";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>标记结案：{candidateLabel}</DialogTitle>
          <DialogDescription>
            选择候选人的最终结论。所在阶段会被同步置为「已结案」，便于归类与统计。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup
            className="grid grid-cols-2 gap-2"
            onValueChange={(v) => setOutcome(v as Exclude<CandidateOutcome, "in_pipeline">)}
            value={outcome}
          >
            {CLOSE_OUTCOMES.map((value) => (
              <div className="flex items-center gap-2" key={value}>
                <RadioGroupItem id={`outcome-${value}`} value={value} />
                <Label className="cursor-pointer text-sm" htmlFor={`outcome-${value}`}>
                  {candidateOutcomeMeta[value].label}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {outcome === "hired" ? (
            <Card className="gap-0 rounded-lg py-0">
              <CardContent className="grid gap-3 bg-muted/30 p-3 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label className="text-xs" htmlFor="hired-joining-date">
                    入职时间（可选）
                  </Label>
                  <DatePicker
                    id="hired-joining-date"
                    onValueChange={setJoiningDate}
                    placeholder="选择入职日期"
                    value={joiningDate}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="hired-department">
                    入职部门（可选）
                  </Label>
                  <Input
                    id="hired-department"
                    maxLength={200}
                    onChange={(e) => setJoiningDepartment(e.target.value)}
                    placeholder="例如 技术部"
                    value={joiningDepartment}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="hired-joining-position">
                    入职岗位（可选）
                  </Label>
                  <Input
                    id="hired-joining-position"
                    maxLength={200}
                    onChange={(e) => setJoiningPosition(e.target.value)}
                    placeholder="例如 高级前端工程师"
                    value={joiningPosition}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="hired-telegram">
                    TG 号（可选）
                  </Label>
                  <Input
                    id="hired-telegram"
                    maxLength={120}
                    onChange={(e) => setTelegram(e.target.value)}
                    placeholder="例如 @username"
                    value={telegram}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="hired-alias">
                    花名（可选）
                  </Label>
                  <Input
                    id="hired-alias"
                    maxLength={120}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="例如 花名"
                    value={alias}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {outcome === "rejected" ? (
            <Card className="gap-0 rounded-lg py-0">
              <CardContent className="grid gap-3 bg-muted/30 p-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="reject-category">
                    淘汰原因分类（可选，用于统计）
                  </Label>
                  <NativeSelect
                    id="reject-category"
                    onChange={(e) => setCategory(e.target.value as CloseCategory)}
                    value={category}
                  >
                    <NativeSelectOption value="">请选择</NativeSelectOption>
                    {closeCategoryValues.map((v) => (
                      <NativeSelectOption key={v} value={v}>
                        {closeCategoryMeta[v].label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="revisit-after">
                    建议多久后再联系（可选）
                  </Label>
                  <DatePicker
                    id="revisit-after"
                    onValueChange={setRevisitAfter}
                    value={revisitAfter}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="close-feedback">
              对外反馈话术（可选，给候选人看）
            </Label>
            <Textarea
              id="close-feedback"
              maxLength={5000}
              onChange={(e) => setFeedbackToCandidate(e.target.value)}
              placeholder="例如：感谢您参与本次招聘流程……"
              rows={2}
              value={feedbackToCandidate}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="close-notes">
              内部备注（可选）
            </Label>
            <Textarea
              id="close-notes"
              maxLength={5000}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="给团队看的真实反馈，不发给候选人"
              rows={2}
              value={internalNotes}
            />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button disabled={submitting || !candidate} onClick={handleConfirm}>
            {submitting ? "处理中…" : "确认结案"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reactivate 模式 ──
// Reactivate mode.

function ReactivateDialog({
  open,
  onOpenChange,
  candidate,
  onCompleted,
}: Omit<TransitionCandidateDialogProps, "mode" | "initialOutcome">) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();

  const [reactivationReason, setReactivationReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReactivationReason("");
    }
  }, [open]);

  async function handleConfirm() {
    if (!candidate) {
      return;
    }
    const trimmedReason = reactivationReason.trim();
    if (!trimmedReason) {
      toast.error("请填写重新激活原因");
      return;
    }
    setSubmitting(true);
    await runAsyncAction({
      cleanup: () => setSubmitting(false),
      onError: (error) => {
        const message =
          (error as ApiError | undefined)?.message ??
          (error instanceof Error ? error.message : "操作失败");
        toast.error(message);
      },
      operation: async () => {
        await transitionInterviewRecord(slug, candidate.id, {
          outcome: "in_pipeline",
          pipelineStage: REACTIVATE_TARGET_STAGE,
          reactivationReason: trimmedReason,
        });
        toast.success(`已重新激活，回到「${REACTIVATE_TARGET_STAGE_LABEL}」`);
        await queryClient.invalidateQueries({
          queryKey: ["studio-resumes", slug, "detail", candidate.id],
        });
        onCompleted();
        onOpenChange(false);
      },
    });
  }

  const candidateLabel = candidate?.candidateName || "该候选人";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重新激活：{candidateLabel}</DialogTitle>
          <DialogDescription>
            恢复到简历初筛阶段。确认后简历评估会重置为「未评估」，已存在的轮次 / Offer 记录会保留。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="reactivation-target-stage">
              回退阶段
            </Label>
            <Select value={REACTIVATE_TARGET_STAGE}>
              <SelectTrigger className="w-full" id="reactivation-target-stage">
                <SelectValue>{REACTIVATE_TARGET_STAGE_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={REACTIVATE_TARGET_STAGE}>
                  {REACTIVATE_TARGET_STAGE_LABEL}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-sm" htmlFor="reactivation-reason">
              激活原因
            </Label>
            <Textarea
              id="reactivation-reason"
              maxLength={500}
              onChange={(event) => setReactivationReason(event.target.value)}
              placeholder="说明为什么需要重新进入招聘流程"
              required
              rows={3}
              value={reactivationReason}
            />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button
            disabled={submitting || !candidate || !reactivationReason.trim()}
            onClick={handleConfirm}
          >
            {submitting ? "处理中…" : "确认重新激活"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
