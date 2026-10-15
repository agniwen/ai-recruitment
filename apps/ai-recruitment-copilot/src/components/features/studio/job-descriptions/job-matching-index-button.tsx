"use client";

import { IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { JobMatchingIndexStatus } from "@arc/shared/job-matching-index";
import { throttle } from "@arc/shared/utils";
import { authClient } from "@/lib/client/auth-client";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { useHasPermission } from "@/hooks/use-has-permission";
import {
  getJobMatchingIndexStatus,
  rebuildJobMatchingIndex,
} from "@/lib/client/api/endpoints/job-matching-index";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const REBUILD_THROTTLE_MS = 1000;

function IndexStatusDetails({ status }: { status: JobMatchingIndexStatus }) {
  const values = [
    ["可选在招岗位", status.total],
    ["岗位结构化画像", status.profiles],
    ["内容一致的索引记录", status.indexed],
    ["等待 / 处理中", status.pending],
    ["处理失败", status.failed],
    ["Qdrant 实际向量点数", status.vectorPoints ?? "无法读取"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4">
        {values.map(([label, value]) => (
          <div className="flex flex-col gap-1" key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-lg font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {status.configurationError || status.vectorError ? (
        <Alert variant="destructive">
          <AlertDescription>{status.configurationError || status.vectorError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function JobMatchingIndexControl() {
  const slug = useWorkspaceSlug();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const requestLocked = useRef(false);
  const queryKey = ["job-matching-index", slug];
  const status = useQuery({
    enabled: open,
    queryFn: () => getJobMatchingIndexStatus(slug),
    queryKey,
    refetchInterval: open ? 5000 : false,
    staleTime: 0,
  });
  const rebuild = useMutation({
    mutationFn: () => rebuildJobMatchingIndex(slug),
    onError: (error) => {
      requestLocked.current = false;
      toast.error(error.message);
    },
    onSuccess: (result) => {
      setOpen(false);
      void client.invalidateQueries({ queryKey, refetchType: "none" });
      toast.success(
        result.queued
          ? `已为 ${result.queued} 个岗位创建后台向量任务`
          : "当前没有需要处理的在招岗位",
      );
    },
    retry: false,
  });
  const { mutate: runRebuild } = rebuild;
  const throttledRebuild = useMemo(
    () =>
      throttle(
        () => {
          requestLocked.current = true;
          runRebuild();
        },
        REBUILD_THROTTLE_MS,
        { leading: true, trailing: false },
      ),
    [runRebuild],
  );
  useEffect(() => () => throttledRebuild.cancel(), [throttledRebuild]);
  const actionDisabled =
    rebuild.isPending ||
    !status.data ||
    Boolean(status.data.configurationError) ||
    status.data.total === 0;
  const submitRebuild = () => {
    if (actionDisabled || requestLocked.current) {
      return;
    }
    throttledRebuild();
  };
  const actionLabel = rebuild.isPending ? "正在提交…" : "重建向量";
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={rebuild.isPending}
        onClick={() => {
          if (open || rebuild.isPending) {
            return;
          }
          requestLocked.current = false;
          setOpen(true);
        }}
      >
        <IconRefresh data-icon="inline-start" />
        重建向量
      </Button>
      <Modal
        title="岗位向量"
        description="处理当前工作区全部可选在招岗位，不受列表筛选影响。缺失画像会自动分析，已确认画像会保留；任务在后台继续。"
        open={open}
        onOpenChange={setOpen}
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button type="button" disabled={actionDisabled} onClick={submitRebuild}>
              {actionLabel}
            </Button>
          </>
        }
      >
        {status.isPending ? (
          <output className="text-sm text-muted-foreground">正在读取岗位和向量状态…</output>
        ) : null}
        {status.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {status.error.message}
              <Button type="button" variant="link" onClick={() => void status.refetch()}>
                重新加载
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {status.data ? <IndexStatusDetails status={status.data} /> : null}
      </Modal>
    </>
  );
}

export function JobMatchingIndexButton() {
  const { data: session, isPending } = authClient.useSession();
  const canUpdate = useHasPermission("jd", "update");
  if (isPending || session?.user.role !== "admin" || !canUpdate) {
    return null;
  }
  return <JobMatchingIndexControl />;
}
