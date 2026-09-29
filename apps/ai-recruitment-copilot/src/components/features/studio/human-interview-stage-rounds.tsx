"use client";
/* oxlint-disable no-use-before-define -- helper components follow the public card */

import {
  IconBan,
  IconCircleCheck,
  IconCopy,
  IconPencil,
  IconPlayerStop,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import { useState } from "react";
import { humanInterviewFormatMeta } from "@arc/db-schema/studio-interviews";
import type {
  HumanInterviewMeetingRecord,
  HumanInterviewRoundRecord,
} from "@arc/shared/studio-pipeline-stages";
import { DATE_TIME_DISPLAY_OPTIONS, TimeDisplay } from "@/components/features/display/time-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  canCancelHumanInterviewRound,
  canCompleteHumanInterviewRound,
  canEndHumanInterviewMeeting,
  canEditHumanInterviewEvaluation,
  canOpenMeetingLinks,
  canRescheduleHumanInterviewRound,
  describeRoundSummaryStatus,
  hasRoundDetails,
} from "./human-interview-stage-utils";

import { EditHumanInterviewRoundDialog } from "./edit-human-interview-round-dialog";

export function RoundCard({
  round,
  canCreate,
  canDelete,
  canUpdate,
  disabled,
  meeting,
  onComplete,
  onCancel,
  onCreateMeeting,
  onEndMeeting,
  onOpenLinks,
  onRescheduled,
}: {
  round: HumanInterviewRoundRecord;
  canCreate: boolean;
  canDelete: boolean;
  canUpdate: boolean;
  disabled?: boolean;
  meeting: HumanInterviewMeetingRecord | null;
  onComplete: () => void;
  onCancel: () => void;
  onCreateMeeting: () => void;
  onEndMeeting: (meeting: HumanInterviewMeetingRecord) => void;
  onOpenLinks: (meeting: HumanInterviewMeetingRecord) => void;
  onRescheduled: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const statusBadge = describeRoundSummaryStatus(round, meeting);
  const canEdit = canUpdate && canRescheduleHumanInterviewRound(round, meeting, disabled);
  const canWrite = disabled !== true;
  const canCreateMeeting =
    canCreate &&
    meeting === null &&
    round.status === "pending" &&
    canWrite &&
    Boolean(round.scheduledAt);
  const canCancelRound = canDelete && canCancelHumanInterviewRound(round, meeting, disabled);
  const canCompleteRound = canUpdate && canCompleteHumanInterviewRound(round, meeting, disabled);
  const canEditEvaluation = canUpdate && canEditHumanInterviewEvaluation(round, disabled);

  return (
    <Card className="gap-0 rounded-lg py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                第 {round.sortOrder + 1} 轮 · {round.label}
              </span>
              <Badge variant={statusBadge.tone}>{statusBadge.label}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
              <RoundScheduleSummary round={round} meeting={meeting} />
              <span className="inline-flex items-center gap-1">
                {humanInterviewFormatMeta[round.format].label}
              </span>
              <span className="inline-flex items-center gap-1">
                <IconUsers className="size-3" />
                {[
                  ...round.interviewers.map((i) => i.name),
                  ...(round.externalInterviewers ?? []).map((i) =>
                    i.telegram.trim()
                      ? `${i.name}（外部 · TG：${i.telegram.trim()}）`
                      : `${i.name}（外部）`,
                  ),
                ].join("、") || "未指派面试官"}
              </span>
            </div>
          </div>
          {canEdit ? (
            <Button onClick={() => setEditing(true)} size="sm" variant="ghost">
              <IconPencil data-icon="inline-start" />
              编辑
            </Button>
          ) : null}
        </div>

        {hasRoundDetails(round) ? (
          <div className="space-y-1 border-border/40 border-t pt-3 text-sm">
            {round.score === null ? null : (
              <div className="text-muted-foreground text-xs">
                评分：<span className="font-medium text-foreground">{round.score}</span>
              </div>
            )}
            {round.feedback ? (
              <p className="whitespace-pre-wrap text-foreground/90 text-xs leading-relaxed">
                {round.feedback}
              </p>
            ) : null}
            {round.cancelReason ? (
              <p className="text-muted-foreground text-xs">取消原因：{round.cancelReason}</p>
            ) : null}
          </div>
        ) : null}

        <RoundCardActions
          canCancelRound={canCancelRound}
          canCompleteRound={canCompleteRound}
          canCreateMeeting={canCreateMeeting}
          canEndMeeting={canUpdate && canEndHumanInterviewMeeting(meeting, disabled)}
          canEditEvaluation={canEditEvaluation}
          canOpenLinks={canOpenMeetingLinks(meeting)}
          meeting={meeting}
          onCancel={onCancel}
          onComplete={onComplete}
          onCreateMeeting={onCreateMeeting}
          onEndMeeting={onEndMeeting}
          onOpenLinks={onOpenLinks}
        />
      </CardContent>
      {editing ? (
        <EditHumanInterviewRoundDialog
          meeting={meeting}
          onOpenChange={setEditing}
          onSaved={onRescheduled}
          round={round}
        />
      ) : null}
    </Card>
  );
}

function RoundCardActions({
  meeting,
  canCreateMeeting,
  canOpenLinks,
  canEndMeeting,
  canCancelRound,
  canCompleteRound,
  canEditEvaluation,
  onComplete,
  onCancel,
  onCreateMeeting,
  onEndMeeting,
  onOpenLinks,
}: {
  meeting: HumanInterviewMeetingRecord | null;
  canCreateMeeting: boolean;
  canOpenLinks: boolean;
  canEndMeeting: boolean;
  canCancelRound: boolean;
  canCompleteRound: boolean;
  canEditEvaluation: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onCreateMeeting: () => void;
  onEndMeeting: (meeting: HumanInterviewMeetingRecord) => void;
  onOpenLinks: (meeting: HumanInterviewMeetingRecord) => void;
}) {
  const hasActions =
    canCreateMeeting ||
    canOpenLinks ||
    canEndMeeting ||
    canCancelRound ||
    canCompleteRound ||
    canEditEvaluation;
  if (!hasActions) {
    return null;
  }

  function handleOpenLinks() {
    if (meeting) {
      onOpenLinks(meeting);
    }
  }

  function handleEndMeeting() {
    if (meeting) {
      onEndMeeting(meeting);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-2 border-border/40 border-t pt-3">
      {canCreateMeeting ? (
        <Button onClick={onCreateMeeting} size="sm" variant="outline">
          <IconVideo className="size-4" />
          创建会议
        </Button>
      ) : null}
      {canOpenLinks ? (
        <Button onClick={handleOpenLinks} size="sm" variant="outline">
          <IconCopy className="size-4" />
          复制链接
        </Button>
      ) : null}
      {canEndMeeting ? (
        <Button onClick={handleEndMeeting} size="sm" variant="outline">
          <IconPlayerStop className="size-4" />
          结束会议
        </Button>
      ) : null}
      {canCompleteRound ? (
        <Button onClick={onComplete} size="sm" variant="outline">
          <IconCircleCheck className="size-4" />
          面试评价
        </Button>
      ) : null}
      {canEditEvaluation ? (
        <Button onClick={onComplete} size="sm" variant="outline">
          <IconPencil className="size-4" />
          编辑评价
        </Button>
      ) : null}
      {canCancelRound ? (
        <Button onClick={onCancel} size="sm" variant="outline">
          <IconBan className="size-4" />
          取消轮次
        </Button>
      ) : null}
    </div>
  );
}

function RoundScheduleSummary({
  round,
  meeting,
}: {
  round: HumanInterviewRoundRecord;
  meeting: HumanInterviewMeetingRecord | null;
}) {
  return (
    <>
      {" "}
      <span>
        {round.scheduledAt ? (
          <TimeDisplay options={DATE_TIME_DISPLAY_OPTIONS} value={round.scheduledAt} />
        ) : (
          "时间未定"
        )}
      </span>
      {meeting?.validUntil ? (
        <span>
          有效至 <TimeDisplay options={DATE_TIME_DISPLAY_OPTIONS} value={meeting.validUntil} />
        </span>
      ) : null}
    </>
  );
}
