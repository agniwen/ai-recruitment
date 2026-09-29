"use client";

import { humanInterviewFormatMeta } from "@arc/db-schema/studio-interviews";
import type { StudioHumanCalendarEvent } from "@arc/shared/studio-calendar";
import { formatDate } from "@arc/shared/utils/time";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useHasPermission } from "@/hooks/use-has-permission";

const statusMeta = {
  ended: { label: "已结束", tone: "outline" },
  in_progress: { label: "进行中", tone: "success" },
  scheduled: { label: "待开始", tone: "info" },
} as const;

export function HumanInterviewEventHoverCard({
  event,
  slug,
  trigger,
}: {
  event: StudioHumanCalendarEvent;
  slug: string;
  trigger: ReactElement;
}) {
  const canViewCandidate = useHasPermission("page", "resumes");
  const status = statusMeta[event.status];
  const candidates = [
    ...new Map(
      event.candidates.map((candidate) => [candidate.interviewRecordId, candidate]),
    ).values(),
  ];
  return (
    <HoverCard>
      <HoverCardTrigger
        closeDelay={200}
        data-calendar-event-preview="human"
        delay={350}
        render={trigger}
      />
      <HoverCardContent
        align="start"
        className="w-auto p-4"
        onClick={(interaction) => interaction.stopPropagation()}
        onPointerDown={(interaction) => interaction.stopPropagation()}
        side="top"
        sideOffset={8}
      >
        <div className="flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium text-sm wrap-anywhere">{event.title}</h3>
              <p className="mt-0.5 text-muted-foreground text-xs">
                真人面试 · {humanInterviewFormatMeta[event.format].label}
              </p>
            </div>
            <Badge className="shrink-0" variant={status.tone}>
              {status.label}
            </Badge>
          </div>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">候选人</dt>
            <dd className="wrap-anywhere">
              {candidates.map((candidate) => candidate.candidateName).join("、") || "未关联"}
            </dd>
            <dt className="text-muted-foreground">面试官</dt>
            <dd className="wrap-anywhere">
              {event.interviewers
                .map(
                  (interviewer) =>
                    `${interviewer.name}（${interviewer.kind === "external" ? "外部" : "内部"}）`,
                )
                .join("、") || "未指派"}
            </dd>
            <dt className="text-muted-foreground">开始时间</dt>
            <dd>{formatDate(event.startAt, "M月D日 HH:mm")}</dd>
            <dt className="text-muted-foreground">结束时间</dt>
            <dd>{formatDate(event.endAt, "M月D日 HH:mm")}</dd>
            {event.location ? (
              <>
                <dt className="text-muted-foreground">地点</dt>
                <dd className="wrap-anywhere">{event.location}</dd>
              </>
            ) : null}
          </dl>
          {canViewCandidate && candidates.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1 border-border/70 border-t pt-2">
              {candidates.map((candidate) => (
                <Link
                  key={candidate.interviewRecordId}
                  className={buttonVariants({ size: "xs", variant: "outline" })}
                  params={{ recordId: candidate.interviewRecordId, slug }}
                  search={{ tab: "human-interview" }}
                  to="/w/$slug/studio/resumes/$recordId"
                >
                  {candidates.length === 1
                    ? "查看候选人详情"
                    : `查看${candidate.candidateName}详情`}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
