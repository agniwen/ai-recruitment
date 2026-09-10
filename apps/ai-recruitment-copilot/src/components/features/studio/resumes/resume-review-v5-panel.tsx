"use client";

import type { ReactNode } from "react";
import type { ResumeReviewV5 } from "@arc/shared/resume-review";
import type { ResumeReviewStatus } from "@arc/db-schema/studio-interviews";
import { cn } from "@arc/shared/utils";
import { RestrictedMarkdownView } from "@/components/features/display/restricted-markdown-view";
import { DimensionRadarChart } from "@/components/ui/chart-radar";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/ui/frame";

const DIMENSIONS = [
  ["skillMatch", "技能匹配"],
  ["experienceRelevance", "经验相关性"],
  ["projectMatch", "项目匹配"],
  ["educationBackground", "教育与背景"],
  ["potential", "潜力"],
  ["stability", "稳定性"],
] as const;
const CORNER_CLASSES = [
  "lg:rounded-[2px] lg:rounded-tr-xl",
  "lg:rounded-[2px] lg:rounded-bl-xl",
  "lg:rounded-[2px] lg:rounded-br-xl",
] as const;
const BASIS_DESCRIPTIONS = {
  both: "根据岗位要求和通用职业标准分析得出",
  general: "根据通用职业标准分析得出",
  job: "根据岗位要求分析得出",
};

function scoreTextClass(score: number | null) {
  if (score === null) {
    return "text-muted-foreground";
  }
  if (score < 40) {
    return "text-red-700 dark:text-red-300";
  }
  if (score < 60) {
    return "text-yellow-700 dark:text-yellow-300";
  }
  if (score < 90) {
    return "text-green-700 dark:text-green-300";
  }
  return "text-purple-700 dark:text-purple-300";
}

function DimensionGroup({
  className,
  entries,
  review,
}: {
  className?: string;
  entries: readonly (typeof DIMENSIONS)[number][];
  review: ResumeReviewV5;
}) {
  return (
    <FramePanel
      className={cn("flex flex-col gap-4", className)}
      data-review-dimension-group={entries.map(([key]) => key).join(",")}
    >
      {entries.map(([key, label], index) => {
        const dimension = review.dimensions[key];
        return (
          <div className={cn(index > 0 && "border-border/50 border-t pt-4")} key={key}>
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-sm">{label}</div>
              <span
                className={cn(
                  "shrink-0 font-medium text-xs tabular-nums leading-none",
                  scoreTextClass(dimension.score),
                )}
              >
                {dimension.score} 分
              </span>
            </div>
            <RestrictedMarkdownView
              className="mt-3 text-sm leading-6"
              content={dimension.rationale}
            />
            <p
              className="mt-2 text-muted-foreground text-xs leading-5"
              data-review-dimension-basis={dimension.basis}
            >
              {BASIS_DESCRIPTIONS[dimension.basis]}
            </p>
          </div>
        );
      })}
    </FramePanel>
  );
}

export function ResumeReviewV5Panel({
  review,
  summaryAction,
  status,
  error,
}: {
  review: ResumeReviewV5;
  summaryAction?: ReactNode;
  status?: ResumeReviewStatus;
  error?: string | null;
}) {
  const dimensions = DIMENSIONS.map(([key, label]) => ({ key, label, ...review.dimensions[key] }));
  const groups = [DIMENSIONS.slice(0, 2), DIMENSIONS.slice(2, 4), DIMENSIONS.slice(4, 6)];
  return (
    <section className="space-y-6" data-slot="resume-review-v5">
      {status === "queued" || status === "processing" ? (
        <p className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300">
          正在重新评价，当前继续展示上一次已完成的结果。
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error || "重新评价失败"}，当前继续展示上一次已完成的结果。
        </p>
      ) : null}
      <Frame>
        <FrameHeader className="justify-between h-10 gap-3">
          <FrameTitle>综合评价</FrameTitle>
          {summaryAction}
        </FrameHeader>
        <FramePanel>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">综合评分</span>
              <span
                className={cn(
                  "font-medium text-sm tabular-nums",
                  scoreTextClass(review.overall.baseScore),
                )}
              >
                {review.overall.baseScore} / 100
              </span>
            </div>
            <h3 className="font-semibold text-base leading-7">{review.overall.conclusion}</h3>
            <div className="text-sm leading-6" data-review-overall-judgment>
              <div className="mb-1 font-medium">判断</div>
              <RestrictedMarkdownView content={review.detailedOverall.judgment} />
            </div>
            <div className="grid gap-5 md:grid-cols-2" data-review-overall-supporting>
              <div className="text-sm leading-6">
                <div className="mb-1 font-medium">匹配依据</div>
                <RestrictedMarkdownView content={review.detailedOverall.matchingEvidence} />
              </div>
              <div className="text-sm leading-6">
                <div className="mb-1 font-medium">风险与待确认项</div>
                <RestrictedMarkdownView content={review.detailedOverall.risks} />
              </div>
            </div>
          </div>
        </FramePanel>
      </Frame>
      <Frame>
        <FrameHeader className="justify-between gap-3">
          <FrameTitle>六维评价</FrameTitle>
        </FrameHeader>
        <div className="grid gap-1 lg:grid-cols-2">
          <FramePanel
            className="flex min-w-0 items-center justify-center lg:rounded-[2px] lg:rounded-tl-xl"
            data-review-radar-panel
          >
            <DimensionRadarChart
              ariaLabel="简历六维评分雷达图"
              dimensions={dimensions}
              tooltipBody={(point) => (
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="font-medium text-foreground">
                    {point.label}：
                    <span className={scoreTextClass(point.score)}>{point.score} 分</span>
                  </div>
                  <RestrictedMarkdownView
                    className="line-clamp-3 text-xs leading-5"
                    content={point.rationale ?? ""}
                  />
                </div>
              )}
            />
          </FramePanel>
          {groups.map((entries, index) => (
            <DimensionGroup
              className={CORNER_CLASSES[index]}
              entries={entries}
              key={entries.map(([key]) => key).join("-")}
              review={review}
            />
          ))}
        </div>
      </Frame>
      <div className="grid gap-4 md:grid-cols-2">
        <Frame>
          <FrameHeader>
            <FrameTitle>职级建议</FrameTitle>
          </FrameHeader>
          <FramePanel className="flex flex-1 flex-col gap-2 text-sm leading-6">
            {review.levelRecommendation ? (
              <>
                <p className="font-medium">{review.levelRecommendation.level}</p>
                <RestrictedMarkdownView content={review.levelRecommendation.rationale} />
              </>
            ) : (
              <p className="text-muted-foreground">本次评价未提供职级建议，可重新评估生成。</p>
            )}
          </FramePanel>
        </Frame>
        <Frame>
          <FrameHeader>
            <FrameTitle>团队定位</FrameTitle>
          </FrameHeader>
          <FramePanel className="flex flex-1 flex-col gap-2 text-sm leading-6">
            {review.teamPositioning ? (
              <>
                <p className="font-medium">{review.teamPositioning.suggestion}</p>
                <RestrictedMarkdownView content={review.teamPositioning.rationale} />
              </>
            ) : (
              <p className="text-muted-foreground">本次评价未提供团队定位建议，可重新评估生成。</p>
            )}
          </FramePanel>
        </Frame>
      </div>
    </section>
  );
}
