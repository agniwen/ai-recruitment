import { IconAlertTriangle, IconFingerprint } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MeetingLogs } from "./api";

type Meeting = MeetingLogs["records"][number];
const roles: Record<string, string> = {
  candidate: "候选人",
  host: "面试官 · 主持人",
  interviewer: "面试官",
  observer: "旁听",
};

function hasMultipleCandidateFingerprints(participant: Meeting["participants"][number]) {
  return participant.role === "candidate" && participant.fingerprints.length > 1;
}

export function MeetingFingerprints({ meeting }: { meeting: Meeting }) {
  const candidateChanged = meeting.participants.some(hasMultipleCandidateFingerprints);
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={150}
        render={<Button variant="ghost" size="sm" />}
        aria-label={`${meeting.meetingTitle}：${meeting.fingerprintCount} 个浏览器指纹${candidateChanged ? "，候选人出现多个浏览器指纹" : ""}，查看详情`}
      >
        <IconFingerprint data-icon="inline-start" />
        {meeting.fingerprintCount} 个
        {candidateChanged ? (
          <Badge variant="warning" aria-label="候选人出现多个浏览器指纹">
            <IconAlertTriangle aria-hidden="true" />
          </Badge>
        ) : null}
        {meeting.fingerprintCount === 0 ? <Badge variant="outline">未采集</Badge> : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(32rem,var(--available-height))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle>浏览器指纹 · {meeting.fingerprintCount} 个</PopoverTitle>
          <PopoverDescription>
            整场会议去重统计；多个身份可能共用同一指纹，指纹数不等于人数。
          </PopoverDescription>
        </PopoverHeader>
        {candidateChanged ? (
          <p className="text-xs text-muted-foreground">
            <Badge variant="warning">
              <IconAlertTriangle data-icon="inline-start" />
              疑似浏览器环境变化
            </Badge>
            <span className="mt-2 block">
              同一候选人出现多个指纹，可能与切换浏览器、设备或环境变化有关，需结合时间线判断。
            </span>
          </p>
        ) : null}
        <ul className="flex flex-col gap-4">
          {meeting.participants.map((participant) => (
            <li key={participant.identity} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all font-medium">
                  {participant.name || participant.identity}
                </span>
                <Badge variant="outline">{roles[participant.role ?? ""] ?? "角色未知"}</Badge>
                <Badge
                  variant={hasMultipleCandidateFingerprints(participant) ? "warning" : "secondary"}
                >
                  {participant.fingerprints.length} 个指纹
                </Badge>
              </div>
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {participant.identity}
              </p>
              {participant.fingerprints.length ? (
                participant.fingerprints.map((fingerprint) => (
                  <code key={fingerprint} className="break-all text-xs select-text">
                    {fingerprint}
                  </code>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">未采集到指纹，暂无法判断环境变化。</p>
              )}
            </li>
          ))}
        </ul>
        {meeting.participants.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无参与身份的指纹记录。</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
