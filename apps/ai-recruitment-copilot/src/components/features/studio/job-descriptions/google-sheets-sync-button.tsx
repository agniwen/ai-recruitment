"use client";

import { IconBrandGoogleDrive, IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { JobDescriptionGoogleSheetsSyncResult } from "@arc/shared/job-descriptions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

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

export function GoogleSheetsSyncButton({
  onSynced,
}: {
  onSynced: (result: JobDescriptionGoogleSheetsSyncResult) => Promise<void> | void;
}) {
  const slug = useWorkspaceSlug();
  const mutation = useMutation({
    mutationFn: () =>
      rpcFetch<JobDescriptionGoogleSheetsSyncResult>(
        rpc.api.w[":slug"].studio["job-descriptions"]["sync-google-sheet"].$post({
          param: { slug },
        }),
        "Google 文档同步失败",
      ),
    mutationKey: ["job-descriptions", "google-sheets-sync", slug],
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Google 文档同步失败");
    },
    onSuccess: async (result) => {
      await onSynced(result);
      const changed =
        result.hiringUnitsCreated +
        result.departmentsCreated +
        result.jobsCreated +
        result.jobsUpdated;
      toast.success(changed > 0 ? "Google 文档同步完成" : "Google 文档没有变化", {
        description: buildResultDescription(result),
      });
    },
  });

  return (
    <Button disabled={mutation.isPending} onClick={() => mutation.mutate()} variant="outline">
      {mutation.isPending ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : (
        <IconBrandGoogleDrive className="size-4" />
      )}
      {mutation.isPending ? "同步中…" : "从 Google 文档同步"}
    </Button>
  );
}
