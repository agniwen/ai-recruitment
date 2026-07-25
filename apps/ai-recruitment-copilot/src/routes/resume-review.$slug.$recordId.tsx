import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useParams,
} from "@tanstack/react-router";
import type { ResumeEvaluationStatus } from "@arc/shared/studio-resumes";
import { describeResumeEvaluationStatus } from "@arc/shared/studio-resumes";
import {
  IconCircleCheck as CircleCheckIcon,
  IconPlus as PlusIcon,
  IconTrash as TrashIcon,
  IconCircleX as OctagonXIcon,
} from "@tabler/icons-react";
import { StudioPersonDetailPanel } from "@/components/features/studio/studio-person-detail-panel";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { fetchStudioResumeReview, submitResumeReviewEvaluation } from "@/lib/client/api";
import { dateTimeLocalInputToISOString } from "@/lib/client/datetime-local";
import { WorkspaceSlugProvider, useWorkspaceSlug } from "@/lib/client/workspace-context";
import { getResumeReviewAccessState } from "@/lib/start/auth-session";
import { useState } from "react";
import { toast } from "sonner";

interface TimeSlotFormValue {
  endAt: string;
  startAt: string;
}

const RESUME_REVIEW_WORKSPACE_PERMISSIONS = {};

function resumeReviewDetailQueryKey(slug: string, recordId: string) {
  return ["studio-resumes", slug, "detail", recordId, "review"] as const;
}

function ResumeReviewEvaluationBar({
  isLoading,
  recordId,
  status,
}: {
  isLoading: boolean;
  recordId: string;
  status: ResumeEvaluationStatus | null | undefined;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [dialogStatus, setDialogStatus] = useState<ResumeEvaluationStatus | null>(null);
  const [reason, setReason] = useState("");
  const [timeSlots, setTimeSlots] = useState<TimeSlotFormValue[]>([{ endAt: "", startAt: "" }]);
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
      queryClient.setQueryData(resumeReviewDetailQueryKey(slug, recordId), detail);
      void queryClient.invalidateQueries({
        queryKey: ["studio-resumes", slug, "timeline", recordId, "review"],
      });
      toast.success("评估已提交");
      setDialogStatus(null);
    },
  });

  const hasSubmittedEvaluation = status !== null && status !== undefined;
  const disabled = isLoading || mutation.isPending;

  function openEvaluationDialog(nextStatus: ResumeEvaluationStatus) {
    setDialogStatus(nextStatus);
    setReason("");
    setTimeSlots([{ endAt: "", startAt: "" }]);
  }

  function updateTimeSlot(index: number, patch: Partial<TimeSlotFormValue>) {
    setTimeSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? { ...slot, ...patch } : slot)),
    );
  }

  function removeTimeSlot(index: number) {
    setTimeSlots((current) => current.filter((_, slotIndex) => slotIndex !== index));
  }

  function handleSubmitEvaluation() {
    if (!dialogStatus) {
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error("请填写评估原因");
      return;
    }
    const availableTimeSlots =
      dialogStatus === "pass"
        ? timeSlots.map((slot) => ({
            endAt: dateTimeLocalInputToISOString(slot.endAt),
            startAt: dateTimeLocalInputToISOString(slot.startAt),
          }))
        : [];

    if (dialogStatus === "pass") {
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
      status: dialogStatus,
    });
  }

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
      <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-2">
        <Button disabled={disabled} onClick={() => openEvaluationDialog("pass")} type="button">
          <CircleCheckIcon className="size-4" />
          评估通过
        </Button>
        <Button
          disabled={disabled}
          onClick={() => openEvaluationDialog("fail")}
          type="button"
          variant="outline"
        >
          <OctagonXIcon className="size-4" />
          评估不通过
        </Button>
      </div>
      <Dialog onOpenChange={(open) => !open && setDialogStatus(null)} open={dialogStatus !== null}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogStatus === "pass" ? "评估通过" : "评估不通过"}</DialogTitle>
            <DialogDescription>
              {dialogStatus === "pass"
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

            {dialogStatus === "pass" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>可预约时间</Label>
                  <Button
                    disabled={timeSlots.length >= 10}
                    onClick={() =>
                      setTimeSlots((current) => [...current, { endAt: "", startAt: "" }])
                    }
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
                        <Input
                          id={`slot-start-${index}`}
                          onChange={(event) =>
                            updateTimeSlot(index, { startAt: event.target.value })
                          }
                          type="datetime-local"
                          value={slot.startAt}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-xs" htmlFor={`slot-end-${index}`}>
                          结束时间
                        </Label>
                        <Input
                          id={`slot-end-${index}`}
                          onChange={(event) => updateTimeSlot(index, { endAt: event.target.value })}
                          type="datetime-local"
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
            <Button onClick={() => setDialogStatus(null)} type="button" variant="outline">
              取消
            </Button>
            <Button disabled={mutation.isPending} onClick={handleSubmitEvaluation} type="button">
              提交评估
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResumeReviewDetailContent({ recordId }: { recordId: string }) {
  const slug = useWorkspaceSlug();
  const detailQuery = useQuery({
    queryFn: () => fetchStudioResumeReview(slug, recordId),
    queryKey: resumeReviewDetailQueryKey(slug, recordId),
    staleTime: 30_000,
  });
  const detail = detailQuery.data ?? null;

  return (
    <>
      <main className="mx-auto flex w-full max-w-[96rem] flex-col px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <StudioPersonDetailPanel
          accessMode="review"
          layoutMode="page"
          mode="resume"
          recordId={recordId}
          shell={({ body, title }) => (
            <div className="flex flex-col gap-4">
              <header className="border-b pb-4">
                <h1 className="font-semibold text-xl tracking-normal">{title}</h1>
              </header>
              <div>{body}</div>
            </div>
          )}
        />
      </main>

      <ResumeReviewEvaluationBar
        isLoading={detailQuery.isLoading}
        recordId={recordId}
        status={detail?.resumeEvaluationStatus}
      />
    </>
  );
}

function ResumeReviewDetailPage() {
  const state = useLoaderData({ from: "/resume-review/$slug/$recordId" });
  const { recordId } = useParams({ from: "/resume-review/$slug/$recordId" });

  if (state.status !== "ready") {
    return null;
  }

  return (
    <WorkspaceSlugProvider
      id={state.workspace.id}
      memberRole={state.member.role}
      permissions={RESUME_REVIEW_WORKSPACE_PERMISSIONS}
      refreshPermissions={false}
      slug={state.workspace.slug}
    >
      <ResumeReviewDetailContent recordId={recordId} />
    </WorkspaceSlugProvider>
  );
}

export const Route = createFileRoute("/resume-review/$slug/$recordId")({
  component: ResumeReviewDetailPage,
  head: () => ({
    meta: [{ title: "简历评估" }],
  }),
  loader: async (loaderContext) => {
    const { location, params } = loaderContext as unknown as {
      location: { pathname: string };
      params: { recordId: string; slug: string };
    };
    const state = await getResumeReviewAccessState({ data: { slug: params.slug } });
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(location.pathname)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
});
