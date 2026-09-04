"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { OdcMemberSummary } from "@arc/shared/hiring-units";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import type { OdcAssignmentTarget } from "./odc-assignment-dialog";

interface BulkOdcAssignmentDialogProps {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  targets: OdcAssignmentTarget[];
}

export function BulkOdcAssignmentDialog({
  onOpenChange,
  onSaved,
  open,
  targets,
}: BulkOdcAssignmentDialogProps) {
  const slug = useWorkspaceSlug();
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const candidatesQuery = useQuery({
    enabled: open,
    queryFn: async () => {
      const payload = await rpcFetch<{ records: OdcMemberSummary[] }>(
        rpc.api.w[":slug"].studio.workspace.members["odc-candidates"].$get({
          param: { slug },
        }),
        "加载 ODC 人员失败",
      );
      return payload.records;
    },
    queryKey: ["workspace-members", slug, "odc-candidates"],
  });

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      (candidatesQuery.data ?? []).map((candidate) => ({
        avatarUrl: candidate.image,
        description: candidate.email,
        label: candidate.name,
        searchValue: `${candidate.name} ${candidate.email}`,
        value: candidate.memberId,
      })),
    [candidatesQuery.data],
  );

  useEffect(() => {
    if (open) {
      setMemberIds([]);
    }
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  async function handleSave() {
    if (targets.length === 0) {
      return;
    }
    setSaving(true);
    try {
      const response = await rpc.api.w[":slug"].studio["hiring-units"].odc.batch.$put({
        json: {
          memberIds,
          targets: targets.map((target) => ({ id: target.id, rowType: target.rowType })),
        },
        param: { slug },
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "批量设置 ODC 失败");
        return;
      }
      toast.success(memberIds.length > 0 ? "已批量设置 ODC" : "已批量清除 ODC 设置");
      onSaved();
      handleOpenChange(false);
    } catch {
      toast.error("批量设置 ODC 失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量设置 ODC</DialogTitle>
          <DialogDescription>
            为已选的 {targets.length} 个用人组织或部门设置相同的 ODC。此操作会覆盖每个已选项原有的
            ODC 设置；不选择人员并保存将清空原设置。
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="bulk-odc-members">ODC 人员（可多选）</FieldLabel>
          <FieldContent>
            <SearchableMultiSelect
              disabled={candidatesQuery.isLoading || saving}
              emptyMessage="暂无角色标记为 ODC 的成员"
              id="bulk-odc-members"
              onChange={setMemberIds}
              options={options}
              placeholder={
                candidatesQuery.isLoading ? "加载 ODC 人员..." : "请选择 ODC 人员（可多选）"
              }
              searchPlaceholder="搜索姓名或邮箱"
              selectedPreviewLimit={3}
              showBadges
              value={memberIds}
            />
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button disabled={saving} onClick={() => handleOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button disabled={candidatesQuery.isLoading || saving} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "覆盖设置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
