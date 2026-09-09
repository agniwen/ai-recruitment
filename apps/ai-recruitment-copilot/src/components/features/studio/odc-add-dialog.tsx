"use client";

import { useMutation } from "@tanstack/react-query";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { OdcAssignmentTarget } from "@/components/features/studio/odc-assignment-dialog";
import { selectOdcAssignmentDrafts, serializeOdcAssignmentDrafts } from "./odc-assignment-draft";
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
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
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
  const [drafts, setDrafts] = useState<OdcAssignmentDraft[]>([]);
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
    mutationFn: (assignments: OdcAssignmentDraft[]) => {
      if (!target) {
        throw new Error("未选择要管理的部门/中心（来源）");
      }
      const json = { assignments: serializeOdcAssignmentDrafts(assignments) };

      return rpcFetch(
        rpc.api.w[":slug"].studio["resume-sources"][":id"].odc.$post({
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
      setDrafts([]);
      onOpenChange(false);
      await onSaved();
    },
  });

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && !createMutation.isPending) {
          setDrafts([]);
          onOpenChange(false);
        }
      }}
      open={open}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>添加 ODC</DialogTitle>
          <DialogDescription>
            可多选角色已标记为 ODC 的成员，分别设置其负责的序列和服务单位。
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
              <SearchableMultiSelect
                disabled={candidatesQuery.isLoading || createMutation.isPending}
                emptyMessage="暂无可选择的 ODC 人员"
                id="odc-management-add-member"
                onChange={(memberIds) =>
                  setDrafts((current) => selectOdcAssignmentDrafts(current, memberIds))
                }
                options={options}
                placeholder={candidatesQuery.isLoading ? "加载 ODC 人员..." : "请选择 ODC 人员"}
                searchPlaceholder="搜索姓名或邮箱"
                value={drafts.map((draft) => draft.memberId)}
              />
            </FieldContent>
          </Field>
        )}
        {drafts.length > 0 ? (
          <OdcAssignmentScopeFields
            assignments={drafts}
            candidates={candidatesQuery.data ?? []}
            disabled={createMutation.isPending}
            onChange={setDrafts}
          />
        ) : null}
        <DialogFooter>
          <Button
            disabled={createMutation.isPending}
            onClick={() => {
              setDrafts([]);
              onOpenChange(false);
            }}
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={
              drafts.length === 0 ||
              candidatesQuery.isLoading ||
              candidatesQuery.isError ||
              createMutation.isPending
            }
            onClick={() => {
              if (drafts.length > 0) {
                createMutation.mutate(drafts);
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
