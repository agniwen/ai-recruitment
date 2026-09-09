"use client";

import type { OdcManagedAssignment, PaginatedOdcAssignmentResult } from "@arc/shared/hiring-units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  actionsColumn,
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
} from "@/components/data-grid";
import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";
import { OdcAddDialog } from "@/components/features/studio/odc-add-dialog";
import type { OdcAssignmentTarget } from "@/components/features/studio/odc-assignment-dialog";
import type { OdcAssignmentDraft } from "@/components/features/studio/odc-assignment-draft";
import { OdcAssignmentScopeFields } from "@/components/features/studio/odc-assignment-scope-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Modal } from "@/components/ui/modal";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useModalPagination } from "@/lib/client/use-modal-pagination";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

const DEFAULT_PAGE_SIZE = 10;
const QUERY_KEY_PREFIX = "odc-management" as const;

interface OdcManagementModalProps {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  target: OdcAssignmentTarget | null;
}

export function OdcManagementModal({
  onOpenChange,
  onSaved,
  open,
  target,
}: OdcManagementModalProps) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, setPageSize } = useModalPagination(DEFAULT_PAGE_SIZE);
  const [editing, setEditing] = useState<OdcManagedAssignment | null>(null);
  const [draft, setDraft] = useState<OdcAssignmentDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OdcManagedAssignment | null>(null);

  const listQueryKey = [
    QUERY_KEY_PREFIX,
    slug,
    target?.rowType ?? null,
    target?.id ?? null,
    page,
    pageSize,
  ] as const;

  const listQuery = useQuery({
    enabled: open && target !== null,
    placeholderData: (previous) => previous,
    queryFn: () => {
      if (!target) {
        return { assignedMemberIds: [], page, pageSize, records: [], total: 0, totalPages: 1 };
      }
      const query = { page: String(page), pageSize: String(pageSize) };

      return rpcFetch<PaginatedOdcAssignmentResult>(
        rpc.api.w[":slug"].studio["resume-sources"][":id"].odc.$get({
          param: { id: target.id, slug },
          query,
        }),
        "加载 ODC 配置失败",
      );
    },
    queryKey: listQueryKey,
    staleTime: 30 * 1000,
  });

  async function invalidateAssignments() {
    await queryClient.invalidateQueries({
      queryKey: [QUERY_KEY_PREFIX, slug, target?.rowType, target?.id],
    });
    onSaved();
  }

  const updateMutation = useMutation({
    mutationFn: (assignment: OdcAssignmentDraft) => {
      if (!target) {
        throw new Error("未选择要管理的简历来源");
      }
      const json = {
        canApproveAiReview: assignment.canApproveAiReview ?? false,
        jobSeries: assignment.jobSeries,
        serviceUnit: assignment.serviceUnit.trim() || null,
      };

      return rpcFetch(
        rpc.api.w[":slug"].studio["resume-sources"][":id"].odc[":memberId"].$patch({
          json,
          param: { id: target.id, memberId: assignment.memberId, slug },
        }),
        "更新 ODC 配置失败",
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "更新 ODC 配置失败");
    },
    onSuccess: async () => {
      toast.success("ODC 配置已更新");
      setEditing(null);
      setDraft(null);
      await invalidateAssignments();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (assignment: OdcManagedAssignment) => {
      if (!target) {
        throw new Error("未选择要管理的简历来源");
      }

      return rpcFetch(
        rpc.api.w[":slug"].studio["resume-sources"][":id"].odc[":memberId"].$delete({
          param: { id: target.id, memberId: assignment.memberId, slug },
        }),
        "删除 ODC 配置失败",
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "删除 ODC 配置失败");
    },
    onSuccess: async () => {
      toast.success("ODC 配置已删除");
      setDeleteTarget(null);
      if ((listQuery.data?.records.length ?? 0) === 1 && page > 1) {
        setPage(page - 1);
      }
      await invalidateAssignments();
    },
  });

  const columns = useMemo(
    () => [
      textColumn<OdcManagedAssignment>({
        key: "name",
        primary: true,
        secondary: (record) => record.email,
        title: "ODC 人员",
      }),
      customColumn<OdcManagedAssignment>({
        cell: (record) => <Badge variant="outline">{record.jobSeries ?? "不限"}</Badge>,
        key: "jobSeries",
        title: "序列",
      }),
      textColumn<OdcManagedAssignment>({
        fallback: "不限",
        key: "serviceUnit",
        title: "服务单位",
      }),
      customColumn<OdcManagedAssignment>({
        cell: (record) => (record.canApproveAiReview ? "允许" : "不允许"),
        key: "canApproveAiReview",
        title: "AI 评价审批",
      }),
      dateColumn<OdcManagedAssignment>({ key: "createdAt", title: "设置时间" }),
      actionsColumn<OdcManagedAssignment>({
        inline: [
          {
            label: "编辑",
            onClick: (record) => {
              setEditing(record);
              setDraft({
                canApproveAiReview: record.canApproveAiReview ?? false,
                jobSeries: record.jobSeries,
                memberId: record.memberId,
                serviceUnit: record.serviceUnit ?? "",
              });
            },
          },
        ],
        menu: [
          {
            label: "删除",
            onClick: setDeleteTarget,
            variant: "destructive",
          },
        ],
      }),
    ],
    [],
  );

  const data = listQuery.data ?? {
    assignedMemberIds: [],
    page,
    pageSize,
    records: [],
    total: 0,
    totalPages: 1,
  };

  return (
    <>
      <Modal
        bodyClassName="px-6 py-5"
        description="查看并维护该范围下已经设置的 ODC。序列或服务单位为空时表示不限。"
        onOpenChange={onOpenChange}
        open={open}
        size="2xl"
        title={`管理 简历来源“${target?.name ?? ""}”的 ODC`}
      >
        <DataGrid<OdcManagedAssignment>
          columns={columns}
          data={data.records}
          empty={
            <Empty className="border-border">
              <EmptyHeader>
                <EmptyTitle>暂无 ODC 配置</EmptyTitle>
                <EmptyDescription>点击上方“添加 ODC”创建第一条配置。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
          error={listQuery.error}
          getRowId={(record) => record.memberId}
          loading={listQuery.isLoading}
          maxHeight={null}
          onRetry={() => void listQuery.refetch()}
          pagination={{
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
            page: data.page,
            pageSize: data.pageSize,
          }}
          refetching={listQuery.isRefetching}
          total={data.total}
          totalPages={data.totalPages}
          toolbarRight={
            <Button onClick={() => setAdding(true)}>
              <IconPlus className="size-4" />
              添加 ODC
            </Button>
          }
        />
      </Modal>

      <OdcAddDialog
        assignedMemberIds={data.assignedMemberIds}
        onOpenChange={setAdding}
        onSaved={async () => {
          setPage(1);
          await invalidateAssignments();
        }}
        open={adding}
        target={target}
      />

      <Dialog
        onOpenChange={(next) => {
          if (!next && !updateMutation.isPending) {
            setEditing(null);
            setDraft(null);
          }
        }}
        open={editing !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑 ODC 配置</DialogTitle>
            <DialogDescription>调整序列和服务单位；留空表示该项不限。</DialogDescription>
          </DialogHeader>
          {draft && editing ? (
            <OdcAssignmentScopeFields
              assignments={[draft]}
              candidates={[editing]}
              disabled={updateMutation.isPending}
              onChange={(assignments) => setDraft(assignments[0] ?? null)}
            />
          ) : null}
          <DialogFooter>
            <Button
              disabled={updateMutation.isPending}
              onClick={() => {
                setEditing(null);
                setDraft(null);
              }}
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={!draft || updateMutation.isPending}
              onClick={() => {
                if (draft) {
                  updateMutation.mutate(draft);
                }
              }}
            >
              {updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EntityDeleteDialog
        confirmDisabled={deleteMutation.isPending}
        confirmLabel={deleteMutation.isPending ? "删除中..." : "删除"}
        description={(record) => `即将删除 ${record.name} 在该简历来源下的 ODC 配置。`}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget);
          }
        }}
        record={deleteTarget}
        title="确认删除这条 ODC 配置？"
      />
    </>
  );
}
