"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { OdcAssignmentSummary } from "@arc/shared/hiring-units";
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
import { selectOdcAssignmentDrafts, serializeOdcAssignmentDrafts } from "./odc-assignment-draft";
import type { OdcAssignmentDraft } from "./odc-assignment-draft";
import { OdcAssignmentScopeFields } from "./odc-assignment-scope-fields";
import { toOdcCandidateOption, useOdcCandidates } from "./use-odc-candidates";

export interface OdcAssignmentTarget {
  id: string;
  name: string;
  odcMembers: OdcAssignmentSummary[];
  rowType: "resumeSource";
}

interface OdcAssignmentDialogProps {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  target: OdcAssignmentTarget | null;
}

export function OdcAssignmentDialog({
  onOpenChange,
  onSaved,
  open,
  target,
}: OdcAssignmentDialogProps) {
  const slug = useWorkspaceSlug();
  const [assignments, setAssignments] = useState<OdcAssignmentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const candidatesQuery = useOdcCandidates(open);

  useEffect(() => {
    if (open) {
      setAssignments(
        target?.odcMembers.map((member) => ({
          canApproveAiReview: member.canApproveAiReview ?? false,
          jobSeries: member.jobSeries,
          memberId: member.memberId,
          serviceUnit: member.serviceUnit ?? "",
        })) ?? [],
      );
    }
  }, [open, target]);

  const options = useMemo(() => {
    const candidates = candidatesQuery.data ?? [];
    const next: SearchableSelectOption[] = candidates.map((candidate) =>
      toOdcCandidateOption(candidate),
    );
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

  function handleMemberIdsChange(memberIds: string[]) {
    setAssignments((current) => selectOdcAssignmentDrafts(current, memberIds));
  }

  async function handleSave() {
    if (!target) {
      return;
    }
    setSaving(true);
    try {
      const json = { assignments: serializeOdcAssignmentDrafts(assignments) };
      const request = rpc.api.w[":slug"].studio["resume-sources"][":id"].odc.$put({
        json,
        param: { id: target.id, slug },
      });
      await rpcFetch(request, "设置 ODC 失败");
      toast.success(assignments.length > 0 ? "ODC 已设置" : "ODC 设置已清除");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "设置 ODC 失败");
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
            为部门/中心（来源）“{target?.name ?? ""}”设置 ODC。这里只显示角色设置中已勾选“是否为
            ODC”的成员；序列或服务单位留空表示不限。
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="odc-members">ODC 人员（可多选）</FieldLabel>
          <FieldContent>
            <SearchableMultiSelect
              disabled={candidatesQuery.isLoading || saving}
              emptyMessage="暂无角色标记为 ODC 的成员"
              id="odc-members"
              onChange={handleMemberIdsChange}
              options={options}
              placeholder={
                candidatesQuery.isLoading ? "加载 ODC 人员..." : "请选择 ODC 人员（可多选）"
              }
              searchPlaceholder="搜索姓名或邮箱"
              selectedPreviewLimit={3}
              showBadges
              value={assignments.map((assignment) => assignment.memberId)}
            />
          </FieldContent>
        </Field>
        <OdcAssignmentScopeFields
          assignments={assignments}
          candidates={[...(candidatesQuery.data ?? []), ...(target?.odcMembers ?? [])]}
          disabled={saving}
          onChange={setAssignments}
        />
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
