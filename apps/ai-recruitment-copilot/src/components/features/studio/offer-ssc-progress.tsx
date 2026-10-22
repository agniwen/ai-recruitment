"use client";

import {
  getOfferDraftStatusMeta,
  getOfferSscConfirmationMeta,
  offerSscConfirmationStatusValues,
} from "@arc/db-schema/studio-interviews";
import type { OfferSscConfirmationStatus } from "@arc/db-schema/studio-interviews";
import type { OfferSscState } from "@arc/shared/studio-pipeline-stages";
import { cn } from "@arc/shared/utils";

const STEP_DESCRIPTIONS: Record<OfferSscConfirmationStatus, string> = {
  completed: "SSC完成确认",
  confirming: "SSC接收确认",
  pending: "创建 Offer 版本",
};

export function OfferSscProgressSteps({
  status,
  recruiterStatus,
}: {
  status: OfferSscConfirmationStatus | null;
  recruiterStatus?: "pending" | "completed" | null;
}) {
  const steps = recruiterStatus
    ? [
        { description: "创建 Offer 版本", key: "created", label: "ODC生成Offer" },
        { description: "确认后自动通知 SSC", key: "recruiter", label: "招聘人员确认私人 TG" },
        {
          description: status === "confirming" ? "SSC已接收，等待完成确认" : "等待SSC接收确认",
          key: "confirming",
          label: "SSC接收确认",
        },
        { description: "SSC完成内部审批确认", key: "completed", label: "SSC完成确认" },
      ]
    : offerSscConfirmationStatusValues.map((step) => ({
        description: STEP_DESCRIPTIONS[step],
        key: step,
        label: getOfferSscConfirmationMeta(step).label,
      }));
  let currentIndex = status ? steps.findIndex((step) => step.key === status) : -1;
  if (recruiterStatus === "pending") {
    currentIndex = 1;
  } else if (recruiterStatus) {
    currentIndex = status === "completed" ? 3 : 2;
  }
  return (
    <ol className="space-y-2">
      {steps.map((step, index) => {
        const current = index === currentIndex;
        const completed = currentIndex >= index;
        return (
          <li
            aria-current={current ? "step" : undefined}
            className={cn("flex items-center gap-3 rounded-md p-2", current && "bg-primary/5")}
            key={step.key}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                completed
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {index < currentIndex ? "✓" : index + 1}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm", current && "font-medium")}>{step.label}</p>
              <p className="text-muted-foreground text-xs">{step.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function describeOfferSscProgress(draft: OfferSscState | null, loading: boolean): string {
  if (loading) {
    return "SSC确认进度加载中…";
  }
  if (!draft) {
    return "尚无 Offer 版本。新建 Offer 后，先由简历上传人确认私人 TG，再通知 SSC 接收并完成确认。";
  }
  if (draft.status === "superseded" || draft.status === "deleted") {
    return `当前最高版本 v${draft.version} ${getOfferDraftStatusMeta(draft.status).label}，不提供 SSC 确认操作。`;
  }
  if (!draft.sscConfirmationStatus) {
    return `当前版本 v${draft.version} 为历史 Offer，未启用 SSC 确认流程。`;
  }
  if (draft.recruiterConfirmationStatus === "pending") {
    return `当前版本 v${draft.version}：待招聘人员确认私人 TG，确认后自动通知 SSC。`;
  }
  return `当前版本 v${draft.version}：${getOfferSscConfirmationMeta(draft.sscConfirmationStatus).label}。操作入口位于当前版本卡片。`;
}

export function OfferSscProgress({
  current,
  loading = false,
}: {
  current: OfferSscState | null;
  loading?: boolean;
}) {
  const retired = current?.status === "superseded" || current?.status === "deleted";
  const status = retired ? null : (current?.sscConfirmationStatus ?? null);
  return (
    <section
      aria-label="SSC确认进度"
      aria-live="polite"
      className="rounded-lg border border-primary/20 bg-muted/20 p-4"
    >
      <h3 className="font-medium text-sm">SSC确认进度</h3>
      <p className="mt-1 text-muted-foreground text-xs">
        {describeOfferSscProgress(current, loading)}
      </p>
      <div className="mt-3">
        <OfferSscProgressSteps
          recruiterStatus={retired ? null : current?.recruiterConfirmationStatus}
          status={status}
        />
      </div>
    </section>
  );
}
