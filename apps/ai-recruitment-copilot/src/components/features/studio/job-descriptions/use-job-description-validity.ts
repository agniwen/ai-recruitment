import { useState } from "react";
import { toast } from "sonner";
import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import type { ActionMenuItem } from "@/components/data-grid";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";

export function useJobDescriptionValidity(canUpdate: boolean, onUpdated: () => void, slug: string) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function updateValidity(record: JobDescriptionListRecord, manuallyInactive: boolean) {
    if (!canUpdate || updatingId) {
      return;
    }
    setUpdatingId(record.id);
    try {
      await rpcFetch<{ manuallyInactive: boolean }>(
        rpc.api.w[":slug"].studio["job-descriptions"][":id"].validity.$patch({
          json: { manuallyInactive },
          param: { id: record.id, slug },
        }),
        "更新岗位状态失败",
      );
      toast.success(manuallyInactive ? "岗位已设为失效" : "岗位已设为生效");
      onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新岗位状态失败");
    } finally {
      setUpdatingId(null);
    }
  }

  const actions: ActionMenuItem<JobDescriptionListRecord>[] = [
    {
      disabled: () => updatingId !== null,
      label: "设为失效",
      onClick: (record) => updateValidity(record, true),
      show: (record) => canUpdate && !record.manuallyInactive && record.googleSheetDeleted !== true,
    },
    {
      disabled: (record) => updatingId !== null || record.googleSheetDeleted === true,
      disabledReason: (record) =>
        record.googleSheetDeleted === true ? "Google 文档中已删除该岗位，无法手动设为生效" : null,
      label: "设为生效",
      onClick: (record) => updateValidity(record, false),
      show: (record) =>
        canUpdate && (record.manuallyInactive || record.googleSheetDeleted === true),
    },
  ];

  return actions;
}
