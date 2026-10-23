"use client";

import type { ResumeProtectionDetails } from "@arc/db-schema/resume-protection";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconShieldLock } from "@tabler/icons-react";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { ResumeProtectionContinueButton } from "./resume-protection-continue-button";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});
const date = (value: string) => dateFormatter.format(new Date(value));
const stages: Record<string, string> = {
  ai_interview: "AI 面试",
  ai_review: "AI 评价审核",
  closed: "已结案",
  human_interview: "真人复面",
  offer: "Offer",
  screening: "简历筛选",
  written_test: "笔试",
};
const outcomes: Record<string, string> = {
  archived: "已归档",
  hired: "已到岗",
  rejected: "已淘汰",
  withdrawn: "已退出",
};

// oxlint-disable-next-line complexity -- One panel renders the protection tag, summary and detail dialog states.
export function ResumeProtectionPanel({
  record,
  tagOnly = false,
  allowContinue = false,
}: {
  record: ResumeLibraryListRecord;
  tagOnly?: boolean;
  allowContinue?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const slug = useWorkspaceSlug();
  const protection = record.resumeProtection;
  const { data, isPending, error, refetch, isFetching } = useQuery({
    enabled: open && Boolean(protection),
    queryFn: () =>
      rpcFetch<ResumeProtectionDetails>(
        rpc.api.w[":slug"].studio.resumes[":id"].protection.$get({
          param: { id: record.id, slug },
        }),
        "加载保护详情失败。",
      ),
    queryKey: ["resume-protection", slug, record.id],
    staleTime: 0,
  });
  if (!protection || record.resumeAdmissionStatus !== "protected") {
    return null;
  }
  const current = data?.protection ?? protection;
  const remainingDays = Math.max(
    0,
    Math.ceil((new Date(current.expiresAt).getTime() - Date.now()) / 86_400_000),
  );
  const label = remainingDays > 0 ? "保护期中" : "保护已到期";
  return (
    <>
      {tagOnly ? (
        <Badge
          render={
            <button
              aria-label="查看推荐保护详情"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(true);
              }}
            />
          }
          variant="warning"
        >
          {label}
        </Badge>
      ) : (
        <Alert className="border-amber-500/25 bg-amber-500/5 xl:col-span-2" role="note">
          <IconShieldLock />
          <AlertTitle>
            推荐保护人：{protection.ownerName} ·{" "}
            {remainingDays > 0 ? `剩余 ${remainingDays} 天` : "保护已到期"}
          </AlertTitle>
          <AlertDescription>
            <p>
              已推荐至{protection.hiringUnitNames.join("、") || "原用人组织"}；保护截止{" "}
              {date(protection.expiresAt)}。
            </p>
            <Button
              className="h-auto p-0"
              variant="link"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(true);
              }}
            >
              查看保护详情
            </Button>
            {allowContinue && <ResumeProtectionContinueButton record={record} />}
          </AlertDescription>
        </Alert>
      )}
      <Modal
        className="resume-protection-detail"
        open={open}
        onOpenChange={setOpen}
        title="推荐保护详情"
        description={`${record.candidateName} · 时间均为北京时间`}
        size="xl"
      >
        {isPending && <Skeleton className="h-48 w-full" />}
        {!isPending && error && (
          <Alert variant="destructive">
            <AlertTitle>保护详情暂时无法加载</AlertTitle>
            <AlertDescription>
              <Button disabled={isFetching} onClick={() => refetch()} variant="outline">
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!isPending && !error && data && (
          <div className="flex flex-col gap-5">
            <Alert role="note">
              <IconShieldLock />
              <AlertTitle>
                {remainingDays > 0
                  ? "该候选人处于推荐保护期"
                  : "原保护期已结束，本次上传仍保留在全部候选人"}
              </AlertTitle>
              <AlertDescription>
                <p>
                  推荐保护人：{current.ownerName}；本次上传人：{record.creatorName || "—"}
                </p>
                <p>
                  首次推荐：{date(current.startsAt)}；保护时长：{current.durationDays} 天
                </p>
                <p>保护截止：{date(current.expiresAt)}</p>
              </AlertDescription>
            </Alert>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用人组织 / 岗位</TableHead>
                  <TableHead>推荐人</TableHead>
                  <TableHead>推荐时间</TableHead>
                  <TableHead>当前招聘进度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recommendations.map((entry, index) => (
                  <TableRow key={`${entry.recommendedAt}-${index}`}>
                    <TableCell>
                      <p>{entry.hiringUnitName || "—"}</p>
                      <p className="text-xs text-muted-foreground">{entry.targetRole || "—"}</p>
                    </TableCell>
                    <TableCell>{current.ownerName}</TableCell>
                    <TableCell>{date(entry.recommendedAt)}</TableCell>
                    <TableCell>
                      {entry.pipelineStage === "closed"
                        ? outcomes[entry.outcome ?? ""] || "已结案"
                        : stages[entry.pipelineStage ?? ""] || "记录已删除"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Modal>
    </>
  );
}
