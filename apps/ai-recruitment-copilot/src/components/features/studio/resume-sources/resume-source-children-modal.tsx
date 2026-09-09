import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HiringUnitRecord } from "@arc/shared/hiring-units";
import type { DepartmentListRecord } from "@arc/shared/departments";
import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { actionsColumn, DataGrid, textColumn } from "@/components/data-grid";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/hooks/use-has-permission";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { useModalPagination } from "@/lib/client/use-modal-pagination";
import { loadStudioJobDescriptionsState } from "@/lib/start/studio/job-descriptions.functions";
import { HiringUnitFormDialog } from "../hiring-units/hiring-unit-form-dialog";
import { DepartmentFormDialog } from "../departments/department-form-dialog";
import { JobDescriptionFormDialog } from "../job-descriptions/job-description-form-dialog";

export type SourceChildKind = "hiringUnit" | "department" | "jd";
const labels = { department: "下属部门", hiringUnit: "下属用人组织", jd: "下属岗位" };
const pages = {
  department: "departments",
  hiringUnit: "hiringUnits",
  jd: "jobDescriptions",
} as const;
type Selected =
  | { kind: "hiringUnit"; record: HiringUnitRecord }
  | { kind: "department"; record: DepartmentListRecord }
  | { kind: "jd"; record: JobDescriptionListRecord };
interface Row {
  id: string;
  name: string;
  description: string | null;
  selected: Selected;
}
interface Page<T> {
  records: T[];
  total: number;
  totalPages: number;
}

function SourceJobDetail({
  record,
  editing,
  onOpenChange,
  onSaved,
}: {
  record: JobDescriptionListRecord;
  editing: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const jobOptions = useQuery({
    queryFn: async () => {
      const state = await loadStudioJobDescriptionsState({ data: { slug } });
      if (state.status !== "ready") {
        throw new Error("无法加载岗位配置，请检查访问权限");
      }
      return state;
    },
    queryKey: ["source-job-form-options", slug],
  });

  if (jobOptions.data) {
    return (
      <JobDescriptionFormDialog
        key={record.id}
        open
        onOpenChange={onOpenChange}
        readOnly={!editing}
        record={record}
        departments={jobOptions.data.departments}
        interviewers={jobOptions.data.interviewers}
        onSaved={onSaved}
      />
    );
  }
  return (
    <Modal open onOpenChange={onOpenChange} title="岗位详情">
      {jobOptions.isError ? (
        <>
          <p>{jobOptions.error.message}</p>
          <Button onClick={() => void jobOptions.refetch()}>重试</Button>
        </>
      ) : (
        <p>正在加载岗位配置...</p>
      )}
    </Modal>
  );
}
function SourceChildDetail({
  selected,
  editing,
  sourceName,
  onOpenChange,
  onSaved,
}: {
  selected: Selected;
  editing: boolean;
  sourceName: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  if (selected.kind === "jd") {
    return (
      <SourceJobDetail
        record={selected.record}
        editing={editing}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    );
  }
  if (editing && selected.kind === "hiringUnit") {
    return (
      <HiringUnitFormDialog
        open
        onOpenChange={onOpenChange}
        record={selected.record}
        onSaved={onSaved}
      />
    );
  }
  if (editing && selected.kind === "department") {
    return (
      <DepartmentFormDialog
        open
        onOpenChange={onOpenChange}
        record={selected.record}
        onSaved={onSaved}
      />
    );
  }
  return (
    <Modal open onOpenChange={onOpenChange} title={selected.record.name}>
      <dl className="grid grid-cols-[auto_1fr] gap-4 text-sm">
        <dt className="text-muted-foreground">部门/中心（来源）</dt>
        <dd>{sourceName}</dd>
        <dt className="text-muted-foreground">名称</dt>
        <dd>{selected.record.name}</dd>
        <dt className="text-muted-foreground">描述</dt>
        <dd className="whitespace-pre-wrap wrap-break-word">
          {selected.record.description || "未填写"}
        </dd>
      </dl>
    </Modal>
  );
}

export function ResumeSourceChildrenModal({
  source,
  kind,
  onClose,
  onChanged,
}: {
  source: { id: string; name: string };
  kind: SourceChildKind;
  onClose: () => void;
  onChanged: () => void;
}) {
  const slug = useWorkspaceSlug();
  const client = useQueryClient();
  const canReadPage = useHasPermission("page", pages[kind]);
  const canRead = useHasPermission(kind, "read");
  const canEdit = useHasPermission(kind, "update");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const { page, pageSize, setPage, setPageSize } = useModalPagination();
  const list = useQuery({
    enabled: canReadPage && canRead,
    queryFn: async (): Promise<Page<Row>> => {
      const args = {
        param: { slug },
        query: {
          page: String(page),
          pageSize: String(pageSize),
          resumeSourceId: source.id,
          search,
        },
      };
      if (kind === "hiringUnit") {
        const result = await rpcFetch<Page<HiringUnitRecord>>(
          rpc.api.w[":slug"].studio["hiring-units"].$get(args),
          "加载用人组织失败",
        );
        return {
          ...result,
          records: result.records.map((record) => ({
            ...record,
            selected: { kind: "hiringUnit", record },
          })),
        };
      }
      if (kind === "department") {
        const result = await rpcFetch<Page<DepartmentListRecord>>(
          rpc.api.w[":slug"].studio.departments.$get(args),
          "加载部门失败",
        );
        return {
          ...result,
          records: result.records.map((record) => ({
            ...record,
            selected: { kind: "department", record },
          })),
        };
      }
      const result = await rpcFetch<Page<JobDescriptionListRecord>>(
        rpc.api.w[":slug"].studio["job-descriptions"].$get(args),
        "加载岗位失败",
      );
      return {
        ...result,
        records: result.records.map((record) => ({ ...record, selected: { kind: "jd", record } })),
      };
    },
    queryKey: ["resume-source-children", slug, source.id, kind, page, pageSize, search],
  });
  function saved() {
    for (const key of [
      "resume-source-children",
      "resume-sources",
      "hiring-units",
      "departments",
      "job-descriptions",
      "scoped-job-descriptions",
      "source-job-form-options",
    ]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
    onChanged();
  }
  if (!canReadPage || !canRead) {
    return null;
  }
  const closeDetail = (open: boolean) => {
    if (!open) {
      setSelected(null);
    }
  };
  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        title={`${source.name} · ${labels[kind]}`}
        size="full"
      >
        <DataGrid<Row>
          empty={
            <p className="p-10 text-center text-muted-foreground">
              {search ? "没有匹配的数据" : "当前部门/中心（来源）下暂无数据"}
            </p>
          }
          columns={[
            textColumn<Row>({ key: "name", primary: true, title: "名称" }),
            textColumn<Row>({ fallback: "—", key: "description", title: "描述" }),
            actionsColumn<Row>({
              inline: [
                {
                  label: "查看",
                  onClick: (row) => {
                    setSelected(row.selected);
                    setEditing(false);
                  },
                },
                {
                  label: "编辑",
                  onClick: (row) => {
                    setSelected(row.selected);
                    setEditing(true);
                  },
                  show: () => canEdit,
                },
              ],
            }),
          ]}
          data={list.data?.records ?? []}
          getRowId={(row) => row.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRefresh={() => void list.refetch()}
          refetching={list.isRefetching}
          pagination={{ onPageChange: setPage, onPageSizeChange: setPageSize, page, pageSize }}
          total={list.data?.total ?? 0}
          totalPages={list.data?.totalPages ?? 1}
          filters={[{ key: "search", placeholder: "搜索名称或描述", type: "search" }]}
          filterValues={{ search }}
          onFilterChange={(_, value) => {
            setSearch(value);
            setPage(1);
          }}
        />
      </Modal>
      {selected && (!editing || canEdit) ? (
        <SourceChildDetail
          selected={selected}
          editing={editing}
          sourceName={source.name}
          onOpenChange={closeDetail}
          onSaved={saved}
        />
      ) : null}
    </>
  );
}
