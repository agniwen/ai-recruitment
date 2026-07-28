"use client";

import { IconBrandGoogleDrive, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  JobDescriptionGoogleSheetsSyncResult,
  JobDescriptionGoogleSheetsSyncRun,
} from "@arc/shared/job-descriptions";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

const SYNC_STATUS_POLL_INTERVAL_MS = 5000;

function buildResultDescription(result: JobDescriptionGoogleSheetsSyncResult): string {
  const parts = [
    `用人组织新增 ${result.hiringUnitsCreated}`,
    `部门新增 ${result.departmentsCreated}`,
    `岗位新增 ${result.jobsCreated}`,
    `岗位更新 ${result.jobsUpdated}`,
    `未变化 ${result.jobsUnchanged}`,
  ];
  if (result.skipped.length > 0) {
    parts.push(`跳过 ${result.skipped.length}`);
  }
  if (result.warnings.length > 0) {
    parts.push(`警告 ${result.warnings.length}`);
  }
  return parts.join("，");
}

function isActiveRun(run: JobDescriptionGoogleSheetsSyncRun | null | undefined): boolean {
  return run?.status === "queued" || run?.status === "running";
}

export function GoogleSheetsSyncButton({
  onSynced,
}: {
  onSynced: (result: JobDescriptionGoogleSheetsSyncResult) => Promise<void> | void;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const queryKey = ["job-descriptions", "google-sheets-sync", slug] as const;
  const observedActiveRunRef = useRef(false);
  const notifiedRunIdRef = useRef<string | null>(null);
  const statusQuery = useQuery({
    queryFn: () =>
      rpcFetch<{ run: JobDescriptionGoogleSheetsSyncRun | null }>(
        rpc.api.w[":slug"].studio["job-descriptions"]["sync-google-sheet"].$get({
          param: { slug },
        }),
        "加载 Google 文档同步状态失败",
      ),
    queryKey,
    refetchInterval: (query) =>
      isActiveRun(query.state.data?.run) ? SYNC_STATUS_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: true,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: () =>
      rpcFetch<JobDescriptionGoogleSheetsSyncRun>(
        rpc.api.w[":slug"].studio["job-descriptions"]["sync-google-sheet"].$post({
          param: { slug },
        }),
        "Google 文档同步失败",
      ),
    mutationKey: ["job-descriptions", "google-sheets-sync-start", slug],
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Google 文档同步失败");
    },
    onSuccess: (run) => {
      queryClient.setQueryData(queryKey, { run });
    },
  });
  const run = statusQuery.data?.run;
  const syncing = mutation.isPending || isActiveRun(run);

  useEffect(() => {
    if (isActiveRun(run)) {
      observedActiveRunRef.current = true;
      return;
    }
    if (
      !run ||
      !observedActiveRunRef.current ||
      notifiedRunIdRef.current === run.id ||
      (run.status !== "succeeded" && run.status !== "failed")
    ) {
      return;
    }
    notifiedRunIdRef.current = run.id;
    observedActiveRunRef.current = false;
    if (run.status === "failed") {
      toast.error(run.error ?? "Google 文档同步失败");
      return;
    }
    if (!run.result) {
      return;
    }
    void Promise.resolve(onSynced(run.result));
    const changed =
      run.result.hiringUnitsCreated +
      run.result.departmentsCreated +
      run.result.jobsCreated +
      run.result.jobsUpdated;
    toast.success(changed > 0 ? "Google 文档同步完成" : "Google 文档没有变化", {
      description: buildResultDescription(run.result),
    });
  }, [onSynced, run]);

  return (
    <Button disabled={syncing} onClick={() => mutation.mutate()} variant="outline">
      {syncing ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : (
        <IconBrandGoogleDrive className="size-4" />
      )}
      {syncing ? "从 Google 文档同步中" : "从 Google 文档同步"}
    </Button>
  );
}

export { isActiveRun, SYNC_STATUS_POLL_INTERVAL_MS };
