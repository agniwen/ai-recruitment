import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  PaginatedResumeLibraryResult,
  ResumeLibraryListRecord,
} from "@arc/shared/studio-resumes";
import { resumeReviewStatusMeta } from "@arc/db-schema/studio-interviews";
import {
  actionsColumn,
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
} from "@/components/data-grid";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useHasPermission } from "@/hooks/use-has-permission";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { PageHeader } from "../page-header";
import { AiReviewDetailDialog } from "./ai-review-detail-dialog";

export function AiReviewPage() {
  const slug = useWorkspaceSlug();
  const canRead = useHasPermission("aiReview", "read");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; tab: "overview" | "ai-review" } | null>(
    null,
  );
  const query = useQuery({
    enabled: canRead,
    queryFn: ({ signal }) =>
      rpcFetch<PaginatedResumeLibraryResult>(
        rpc.api.w[":slug"].studio["ai-review"].$get(
          {
            param: { slug },
            query: { candidateName: search, page: String(page), pageSize: String(pageSize) },
          },
          { init: { signal } },
        ),
        "加载待审批简历失败",
      ),
    queryKey: ["ai-review-approvals", slug, page, pageSize, search],
  });
  const columns = [
    textColumn<ResumeLibraryListRecord>({
      key: "candidateName",
      primary: true,
      secondary: (record) => record.candidateEmail ?? record.candidatePhone ?? "—",
      title: "候选人",
    }),
    textColumn<ResumeLibraryListRecord>({
      fallback: "未绑定岗位",
      key: "jobDescriptionName",
      title: "应聘岗位",
    }),
    textColumn<ResumeLibraryListRecord>({
      fallback: "—",
      key: "hiringUnitName",
      title: "用人组织",
    }),
    customColumn<ResumeLibraryListRecord>({
      cell: (record) => (
        <Badge variant={resumeReviewStatusMeta[record.resumeReviewStatus].tone}>
          {resumeReviewStatusMeta[record.resumeReviewStatus].label}
        </Badge>
      ),
      key: "resumeReviewStatus",
      title: "AI 评价状态",
    }),
    customColumn<ResumeLibraryListRecord>({
      cell: (record) => (
        <Badge variant={record.aiReviewApprovalStatus === "rejected" ? "danger" : "warning"}>
          {record.aiReviewApprovalStatus === "rejected" ? "未通过" : "待审批"}
        </Badge>
      ),
      key: "aiReviewApprovalStatus",
      title: "审批状态",
    }),
    customColumn<ResumeLibraryListRecord>({
      cell: (record) => record.resumeReviewBaseScore ?? "—",
      key: "resumeReviewBaseScore",
      title: "AI 评分",
    }),
    dateColumn<ResumeLibraryListRecord>({ key: "createdAt", title: "加入时间" }),
    actionsColumn<ResumeLibraryListRecord>({
      inline: [
        {
          label: "候选人概览",
          onClick: (record) => setSelected({ id: record.id, tab: "overview" }),
        },
        { label: "AI 评价", onClick: (record) => setSelected({ id: record.id, tab: "ai-review" }) },
      ],
    }),
  ];
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6">
      <PageHeader
        title="AI 分析审批"
        description="审核候选人的 AI 评价，审批通过后进入简历筛选。"
      />
      {canRead ? (
        <DataGrid<ResumeLibraryListRecord>
          columns={columns}
          data={query.data?.records ?? []}
          getRowId={(record) => record.id}
          loading={query.isLoading}
          refetching={query.isRefetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRefresh={() => void query.refetch()}
          total={query.data?.total ?? 0}
          totalPages={query.data?.totalPages ?? 1}
          pagination={{
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
            page,
            pageSize,
          }}
          filters={[{ key: "search", placeholder: "搜索候选人姓名", type: "search" }]}
          filterValues={{ search }}
          onFilterChange={(_, value) => {
            setSearch(value);
            setPage(1);
          }}
          empty={
            <Empty>
              <EmptyHeader>
                <EmptyTitle>暂无待审批简历</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? "没有匹配的候选人，请调整搜索条件。"
                    : "当前可见范围内没有处于 AI 评价审核阶段的候选人。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无查看权限</EmptyTitle>
            <EmptyDescription>请在角色与权限中配置「AI 分析审批 → 查看」。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {selected && canRead ? (
        <AiReviewDetailDialog
          key={selected.id}
          recordId={selected.id}
          initialTab={selected.tab}
          onClose={() => setSelected(null)}
          onApproved={() => {
            setSelected(null);
            setPage(1);
          }}
        />
      ) : null}
    </div>
  );
}
