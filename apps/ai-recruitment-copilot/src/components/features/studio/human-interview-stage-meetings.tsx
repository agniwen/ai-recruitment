"use client";

/* oxlint-disable no-use-before-define -- helper components follow the public dialog */

import { IconCopy, IconLink, IconLoader2, IconUsers } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { toast } from "sonner";
import type { HumanInterviewMeetingInterviewerRole } from "@arc/db-schema/studio-interviews";
import type {
  HumanInterviewMeetingLinkBundle,
  HumanInterviewMeetingRecord,
} from "@arc/shared/studio-pipeline-stages";
import { issueHumanInterviewMeetingLinks } from "@/lib/client/api";
import { copyTextToClipboard, toAbsoluteUrl } from "@/lib/client/clipboard";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "./human-interview-stage-utils";

export function EndMeetingDialog({
  isPending,
  meeting,
  onConfirm,
  onOpenChange,
}: {
  isPending: boolean;
  meeting: HumanInterviewMeetingRecord | null;
  onConfirm: (meeting: HumanInterviewMeetingRecord) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  async function handleConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (meeting) {
      try {
        await onConfirm(meeting);
      } catch {
        // The mutation already surfaces the error toast; keep the dialog open.
      }
    }
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={meeting !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>结束真人复面会议？</AlertDialogTitle>
          <AlertDialogDescription>
            结束后会关闭当前视频房间，已拿到链接的候选人和面试官将不能继续进入该会议。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={handleConfirm} variant="destructive">
            {isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
            确认结束
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const interviewerRoleLabel: Record<HumanInterviewMeetingInterviewerRole, string> = {
  host: "主持人",
  interviewer: "面试官",
  observer: "旁听",
};

export function MeetingLinksDialog({
  meeting,
  onOpenChange,
}: {
  meeting: HumanInterviewMeetingRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const slug = useWorkspaceSlug();
  const { data, error, isFetching } = useQuery({
    enabled: Boolean(meeting),
    queryFn: () => {
      if (!meeting) {
        throw new Error("missing meeting");
      }
      return issueHumanInterviewMeetingLinks(slug, meeting.id);
    },
    queryKey: ["human-interview-meeting-links", slug, meeting?.id],
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={meeting !== null}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>复制面试链接</DialogTitle>
          <DialogDescription>
            {meeting?.title ?? "真人复面会议"} 的候选人和面试官入场链接。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60dvh] space-y-5 overflow-y-auto py-1">
          {isFetching ? (
            <Card className="gap-0 rounded-lg py-0">
              <CardContent className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
                <IconLoader2 className="size-4 animate-spin" />
                生成链接中…
              </CardContent>
            </Card>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
              {error instanceof Error ? error.message : "生成链接失败"}
            </p>
          ) : null}
          {data ? (
            <MeetingLinksContent links={data} scheduledAt={meeting?.scheduledAt ?? null} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MeetingLinksContent({
  links,
  scheduledAt,
}: {
  links: HumanInterviewMeetingLinkBundle;
  scheduledAt: string | null;
}) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h4 className="flex items-center gap-2 font-medium text-sm">
          <IconUsers className="size-4" />
          候选人确认链接
        </h4>
        <p className="text-muted-foreground text-xs">
          复制后包含公司、岗位、轮次和面试时间，可直接发送给候选人。
        </p>
        <div className="space-y-2">
          {links.candidateLinks.map((link) => (
            <MeetingLinkRow
              copyText={buildCandidateLinkCopy({
                candidateName: link.candidateName,
                companyName: link.companyName,
                jobDescriptionName: link.jobDescriptionName,
                roundLabel: link.roundLabel,
                scheduledAt,
                url: link.url,
              })}
              description={`${link.jobDescriptionName ?? "未关联岗位"} · ${link.roundLabel} · 有效至 ${formatDateTime(link.expiresAt)}`}
              key={link.roundId}
              label={link.candidateName}
              url={link.url}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="flex items-center gap-2 font-medium text-sm">
          <IconLink className="size-4" />
          面试官会议链接
        </h4>
        <p className="text-muted-foreground text-xs">
          复制后包含会议名称、岗位、部门、用人组织、面试时间和会议身份，可直接发送给面试官。
        </p>
        <div className="space-y-2">
          {links.interviewerLinks.map((link) => (
            <MeetingLinkRow
              copyText={buildInterviewerLinkCopy({
                departmentNames: formatMeetingNames(links, "departmentName"),
                external: link.external ?? false,
                hiringUnitNames: formatMeetingNames(links, "hiringUnitName"),
                interviewerName: link.name,
                jobDescriptionName: formatMeetingJobNames(links),
                meetingTitle: links.title,
                roleLabel: interviewerRoleLabel[link.role],
                scheduledAt,
                url: link.url,
              })}
              description={`${link.external ? "外部面试官 · 无需登录 · " : ""}${interviewerRoleLabel[link.role]} · ${formatMeetingJobNames(links)}`}
              key={link.userId}
              label={link.name}
              url={link.url}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export function buildCandidateLinkCopy({
  candidateName,
  companyName,
  jobDescriptionName,
  roundLabel,
  scheduledAt,
  url,
}: {
  candidateName: string;
  companyName: string | null;
  jobDescriptionName: string | null;
  roundLabel: string;
  scheduledAt: string | null;
  url: string;
}): string {
  const timeCopy = scheduledAt ? `\n面试时间：${formatDateTime(scheduledAt)}` : "";
  const companyCopy = companyName ? `\n公司：${companyName}` : "";
  return `${candidateName}，您好：\n这是您的真人面试确认链接。${companyCopy}\n应聘岗位：${jobDescriptionName ?? "待确认"}\n面试轮次：${roundLabel}${timeCopy}\n请打开链接确认是否参加，本链接仅供本人使用，请勿转发。\n${toAbsoluteUrl(url)}`;
}

export function buildInterviewerLinkCopy({
  departmentNames,
  external,
  hiringUnitNames,
  interviewerName,
  jobDescriptionName,
  meetingTitle,
  roleLabel,
  scheduledAt,
  url,
}: {
  departmentNames: string | null;
  external: boolean;
  hiringUnitNames: string | null;
  interviewerName: string;
  jobDescriptionName: string;
  meetingTitle: string;
  roleLabel: string;
  scheduledAt: string | null;
  url: string;
}): string {
  const timeCopy = scheduledAt ? `\n面试时间：${formatDateTime(scheduledAt)}` : "";
  const organizationCopy = hiringUnitNames ? `\n用人组织：${hiringUnitNames}` : "";
  const departmentCopy = departmentNames ? `\n部门：${departmentNames}` : "";
  const accessCopy = external ? "无需登录即可打开" : "请使用本人账号打开";
  return `${interviewerName}，您好：\n这是「${meetingTitle}」真人面试的面试官会议链接。\n岗位：${jobDescriptionName}${organizationCopy}${departmentCopy}${timeCopy}\n您本次的会议身份为${roleLabel}，${accessCopy}，本链接请勿转发。\n${toAbsoluteUrl(url)}`;
}

export function formatMeetingJobNames(links: HumanInterviewMeetingLinkBundle): string {
  return formatMeetingNames(links, "jobDescriptionName") ?? "未关联岗位";
}

export function formatMeetingNames(
  links: HumanInterviewMeetingLinkBundle,
  field: "departmentName" | "hiringUnitName" | "jobDescriptionName",
): string | null {
  const names = [
    ...new Set(links.candidateLinks.map((link) => link[field]?.trim()).filter(Boolean)),
  ];
  return names.length > 0 ? names.join("、") : null;
}

function MeetingLinkRow({
  copyText,
  description,
  label,
  url,
}: {
  copyText: string;
  description: string;
  label: string;
  url: string;
}) {
  const absoluteUrl = toAbsoluteUrl(url);

  async function handleCopy() {
    const result = await copyTextToClipboard(copyText);
    if (result === "copied") {
      toast.success("发送文案已复制");
      return;
    }
    if (result === "manual") {
      toast.info("已打开手动复制窗口");
      return;
    }
    toast.error("复制失败，请手动选择链接或文案");
  }

  return (
    <Card className="gap-0 rounded-lg py-0">
      <CardContent className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{label}</span>
            <Badge variant="outline">{description}</Badge>
          </div>
          <Input className="h-8 text-xs" readOnly value={absoluteUrl} />
        </div>
        <Button className="md:self-end" onClick={handleCopy} size="sm" variant="outline">
          <IconCopy className="size-4" />
          复制消息
        </Button>
      </CardContent>
    </Card>
  );
}
