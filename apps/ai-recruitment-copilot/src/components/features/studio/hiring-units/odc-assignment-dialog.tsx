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
import type { HiringUnitTreeRow } from "./hiring-unit-tree";

export function OdcAssignmentDialog({
  onOpenChange,
  onSaved,
  open,
  target,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  target: HiringUnitTreeRow | null;
}) {
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

  useEffect(() => {
    if (open) {
      setMemberIds(target?.odcMembers.map((member) => member.memberId) ?? []);
    }
  }, [open, target]);

  const options = useMemo(() => {
    const candidates = candidatesQuery.data ?? [];
    const next: SearchableSelectOption[] = candidates.map((candidate) => ({
      avatarUrl: candidate.image,
      description: candidate.email,
      label: candidate.name,
      searchValue: `${candidate.name} ${candidate.email}`,
      value: candidate.memberId,
    }));
    for (const current of target?.odcMembers ?? []) {
      if (!candidates.some((candidate) => candidate.memberId === current.memberId)) {
        next.unshift({
          avatarUrl: current.image,
          description: `${current.email} · 当前角色未标记为 ODC，仅可清除`,
          disabled: true,
          label: current.name,
          searchValue: `${current.name} ${current.email}`,
          value: current.memberId,
        });
      }
    }
    return next;
  }, [candidatesQuery.data, target?.odcMembers]);

  async function handleSave() {
    if (!target) {
      return;
    }
    setSaving(true);
    try {
      const response =
        target.rowType === "hiringUnit"
          ? await rpc.api.w[":slug"].studio["hiring-units"][":id"].odc.$put({
              json: { memberIds },
              param: { id: target.id, slug },
            })
          : await rpc.api.w[":slug"].studio.departments[":id"].odc.$put({
              json: { memberIds },
              param: { id: target.id, slug },
            });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        toast.error(payload?.error ?? "设置 ODC 失败");
        return;
      }
      toast.success(memberIds.length > 0 ? "ODC 已设置" : "ODC 设置已清除");
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error("设置 ODC 失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置 ODC</DialogTitle>
          <DialogDescription>
            为{target?.rowType === "department" ? "部门" : "用人组织"}“{target?.name ?? ""}”设置
            ODC。这里只显示角色设置中已勾选“是否为 ODC”的成员。
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="odc-members">ODC 人员（可多选）</FieldLabel>
          <FieldContent>
            <SearchableMultiSelect
              disabled={candidatesQuery.isLoading || saving}
              emptyMessage="暂无角色标记为 ODC 的成员"
              id="odc-members"
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
          <Button disabled={saving} onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button disabled={candidatesQuery.isLoading || saving} onClick={() => void handleSave()}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
