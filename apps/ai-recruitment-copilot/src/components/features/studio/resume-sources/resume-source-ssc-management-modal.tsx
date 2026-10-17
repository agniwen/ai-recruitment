"use client";

import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { actionsColumn, DataGrid, dateColumn, textColumn } from "@/components/data-grid";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Modal } from "@/components/ui/modal";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useModalPagination } from "@/lib/client/use-modal-pagination";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { EntityDeleteDialog } from "../entity-delete-dialog";
import { SscResponsibilityEditorDialog } from "../ssc-responsibilities/ssc-responsibilities-grid";
import type {
  SscResponsibilityRecord,
  SscResponsibilitySource,
} from "../ssc-responsibilities/ssc-responsibilities-grid";
import { invalidateSscResponsibilityQueries } from "../ssc-responsibilities/ssc-responsibility-queries";
import { ResumeSourceSscAddDialog } from "./resume-source-ssc-add-dialog";

interface SourceSscManagementProps {
  open: boolean;
  target: SscResponsibilitySource;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface SscListResult {
  records: SscResponsibilityRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function SourceSscManagement({ target, onOpenChange, onSaved }: SourceSscManagementProps) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, setPageSize } = useModalPagination(10);
  const [adding, setAdding] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SscResponsibilityRecord | null>(null);
  const [deleting, setDeleting] = useState<SscResponsibilityRecord | null>(null);
  const list = useQuery({
    queryFn: () =>
      rpcFetch<SscListResult>(
        rpc.api.w[":slug"].studio["ssc-responsibilities"].$get({
          param: { slug },
          query: {
            page: String(page),
            pageSize: String(pageSize),
            resumeSourceId: target.id,
            sortBy: "sscName",
            sortOrder: "asc",
          },
        }),
        "加载 SSC 配置失败",
      ),
    queryKey: ["studio-ssc-responsibilities", slug, "source", target.id, page, pageSize],
    staleTime: 30_000,
  });
  async function refresh() {
    await invalidateSscResponsibilityQueries(queryClient, slug);
    onSaved();
  }
  const deletion = useMutation({
    mutationFn: (id: string) =>
      rpcFetch(
        rpc.api.w[":slug"].studio["ssc-responsibilities"][":id"].$delete({ param: { id, slug } }),
        "删除 SSC 配置失败",
      ),
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除 SSC 配置失败"),
    onSuccess: async () => {
      toast.success("SSC 配置已删除");
      setDeleting(null);
      if (list.data?.records.length === 1 && page > 1) {
        setPage(page - 1);
      }
      await refresh();
    },
  });
  const columns = [
    textColumn<SscResponsibilityRecord>({
      fallback: "待补充",
      key: "sscName",
      primary: true,
      title: "SSC 花名",
    }),
    textColumn<SscResponsibilityRecord>({ fallback: "待补充", key: "email", title: "SSC 邮箱" }),
    textColumn<SscResponsibilityRecord>({ fallback: "待补充", key: "telegram", title: "SSC TG" }),
    textColumn<SscResponsibilityRecord>({
      fallback: "待设置角色",
      key: "workspaceRoleName",
      title: "工作区角色",
    }),
    textColumn<SscResponsibilityRecord>({ key: "demandOwner", title: "需求对接负责人" }),
    textColumn<SscResponsibilityRecord>({ key: "notes", title: "备注" }),
    dateColumn<SscResponsibilityRecord>({ key: "createdAt", title: "设置时间" }),
    actionsColumn<SscResponsibilityRecord>({
      inline: [
        {
          label: "编辑",
          onClick: (row) => {
            setEditing(row);
            setEditorOpen(true);
          },
        },
        { label: "删除", onClick: setDeleting },
      ],
    }),
  ];
  return (
    <>
      <Modal
        open
        onOpenChange={onOpenChange}
        title={`管理 部门/中心（来源）“${target.name}”的 SSC`}
        description="维护当前中心/部门的 SSC 人员。SSC 在新 Offer 待接收后，才可查看所负责范围的相关候选人。"
        size="2xl"
        bodyClassName="px-6 py-5"
      >
        <DataGrid<SscResponsibilityRecord>
          columns={columns}
          data={list.data?.records ?? []}
          getRowId={(row) => row.id}
          loading={list.isPending}
          error={list.error}
          refetching={list.isRefetching}
          onRetry={() => void list.refetch()}
          onRefresh={() => void list.refetch()}
          total={list.data?.total ?? 0}
          totalPages={list.data?.totalPages ?? 1}
          maxHeight={null}
          pagination={{ onPageChange: setPage, onPageSizeChange: setPageSize, page, pageSize }}
          toolbarRight={
            <Button onClick={() => setAdding(true)}>
              <IconPlus className="size-4" />
              添加 SSC
            </Button>
          }
          empty={
            <Empty className="border-border">
              <EmptyHeader>
                <EmptyTitle>暂无 SSC 配置</EmptyTitle>
                <EmptyDescription>点击“添加 SSC”选择人员或预录新 SSC。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      </Modal>
      {adding ? (
        <ResumeSourceSscAddDialog
          source={target}
          onOpenChange={setAdding}
          onSaved={async () => {
            setPage(1);
            await refresh();
          }}
          onPreregister={() => {
            setAdding(false);
            setEditing(null);
            setEditorOpen(true);
          }}
        />
      ) : null}
      {editorOpen ? (
        <SscResponsibilityEditorDialog
          open
          record={editing}
          fixedSource={target}
          onOpenChange={setEditorOpen}
          onSaved={() => {
            setPage(1);
            onSaved();
          }}
        />
      ) : null}
      <EntityDeleteDialog
        record={deleting}
        isPending={deletion.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            deletion.mutate(deleting.id);
          }
        }}
        title="确认删除这条 SSC 配置？"
        description={(row) =>
          `即将删除 ${row.sscName || row.email || "待补充的 SSC"} 在“${target.name}”下的 SSC 负责关系。`
        }
      />
    </>
  );
}

export function ResumeSourceSscManagementModal(props: SourceSscManagementProps) {
  return props.open ? <SourceSscManagement key={props.target.id} {...props} /> : null;
}
