"use client";

import { useMutation } from "@tanstack/react-query";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { OdcAssignmentTarget } from "@/components/features/studio/odc-assignment-dialog";
import type { OdcAssignmentDraft } from "@/components/features/studio/odc-assignment-draft";
import { OdcAssignmentScopeFields } from "@/components/features/studio/odc-assignment-scope-fields";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { toOdcCandidateOption, useOdcCandidates } from "./use-odc-candidates";

interface OdcAddDialogProps {
  assignedMemberIds: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
  open: boolean;
  target: OdcAssignmentTarget | null;
}

export function OdcAddDialog({
  assignedMemberIds,
  onOpenChange,
  onSaved,
  open,
  target,
}: OdcAddDialogProps) {
  const slug = useWorkspaceSlug();
  const [draft, setDraft] = useState<OdcAssignmentDraft | null>(null);
  const candidatesQuery = useOdcCandidates(open);
  const assignedMemberIdSet = useMemo(() => new Set(assignedMemberIds), [assignedMemberIds]);
  const options = useMemo(
    () =>
      (candidatesQuery.data ?? []).map((candidate) =>
        toOdcCandidateOption(candidate, assignedMemberIdSet.has(candidate.memberId)),
      ),
    [assignedMemberIdSet, candidatesQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (assignment: OdcAssignmentDraft) => {
      if (!target) {
        throw new Error("未选择要管理的组织或部门");
      }
      const json = {
        jobSeries: assignment.jobSeries,
        memberId: assignment.memberId,
        serviceUnit: assignment.serviceUnit.trim() || null,
      };
      if (target.rowType === "hiringUnit") {
        return rpcFetch(
          rpc.api.w[":slug"].studio["hiring-units"][":id"].odc.$post({
            json,
            param: { id: target.id, slug },
          }),
          "添加 ODC 失败",
        );
      }
      return rpcFetch(
        rpc.api.w[":slug"].studio.departments[":id"].odc.$post({
          json,
          param: { id: target.id, slug },
        }),
        "添加 ODC 失败",
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "添加 ODC 失败");
    },
    onSuccess: async () => {
      toast.success("ODC 已添加");
      setDraft(null);
      onOpenChange(false);
      await onSaved();
    },
  });

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && !createMutation.isPending) {
          setDraft(null);
          onOpenChange(false);
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 ODC</DialogTitle>
          <DialogDescription>
            选择一名角色已标记为 ODC 的成员，并设置其负责的序列和服务单位。
          </DialogDescription>
        </DialogHeader>
        {candidatesQuery.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border py-8 text-center">
            <IconAlertCircle className="size-5 text-destructive" />
            <p className="text-sm">ODC 人员加载失败，请重试。</p>
            <Button onClick={() => void candidatesQuery.refetch()} type="button" variant="outline">
              重新加载
            </Button>
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor="odc-management-add-member">ODC 人员</FieldLabel>
            <FieldContent>
              <SearchableSelect
                disabled={candidatesQuery.isLoading || createMutation.isPending}
                emptyMessage="暂无可选择的 ODC 人员"
                id="odc-management-add-member"
                onChange={(memberId) =>
                  setDraft(memberId ? { jobSeries: null, memberId, serviceUnit: "" } : null)
                }
                options={options}
                placeholder={candidatesQuery.isLoading ? "加载 ODC 人员..." : "请选择 ODC 人员"}
                required
                searchPlaceholder="搜索姓名或邮箱"
                value={draft?.memberId}
              />
            </FieldContent>
          </Field>
        )}
        {draft ? (
          <OdcAssignmentScopeFields
            assignments={[draft]}
            candidates={candidatesQuery.data ?? []}
            disabled={createMutation.isPending}
            onChange={(assignments) => setDraft(assignments[0] ?? null)}
          />
        ) : null}
        <DialogFooter>
          <Button
            disabled={createMutation.isPending}
            onClick={() => {
              setDraft(null);
              onOpenChange(false);
            }}
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={
              !draft ||
              candidatesQuery.isLoading ||
              candidatesQuery.isError ||
              createMutation.isPending
            }
            onClick={() => {
              if (draft) {
                createMutation.mutate(draft);
              }
            }}
          >
            {createMutation.isPending ? "添加中..." : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
