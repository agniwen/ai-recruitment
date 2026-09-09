import { ResumeSourceChildrenModal } from "./resume-source-children-modal";
import type { SourceChildKind } from "./resume-source-children-modal";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResumeSourceRecord } from "@arc/shared/resume-sources";
import { IconPlus } from "@tabler/icons-react";
import {
  actionsColumn,
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
} from "@/components/data-grid";
import { PageHeader } from "../page-header";
import { OdcAvatarGroup } from "../odc-avatar-group";
import { OdcAssignmentDialog } from "../odc-assignment-dialog";
import { OdcManagementModal } from "../odc-management-modal";
import { useEntityCrud } from "../use-entity-crud";
import { EntityDeleteDialog } from "../entity-delete-dialog";
import { ResumeSourceFormDialog } from "./resume-source-form-dialog";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/hooks/use-has-permission";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function ResumeSourceManagementPage() {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const canCreate = useHasPermission("hiringUnit", "create");
  const canUpdate = useHasPermission("hiringUnit", "update");
  const canDelete = useHasPermission("hiringUnit", "delete");
  const canReadUnits = useHasPermission("hiringUnit", "read");
  const canReadDepartments = useHasPermission("department", "read");
  const canReadJobs = useHasPermission("jd", "read");
  const canViewUnitsPage = useHasPermission("page", "hiringUnits");
  const canViewDepartmentsPage = useHasPermission("page", "departments");
  const canViewJobsPage = useHasPermission("page", "jobDescriptions");
  const [childrenTarget, setChildrenTarget] = useState<{
    source: ResumeSourceRecord;
    kind: SourceChildKind;
  } | null>(null);
  function countCell(
    source: ResumeSourceRecord,
    kind: SourceChildKind,
    text: string,
    allowed: boolean,
  ) {
    return allowed ? (
      <Button
        variant="link"
        className="h-auto p-0"
        onClick={() => setChildrenTarget({ kind, source })}
      >
        {text}
      </Button>
    ) : (
      text
    );
  }
  const [search, setSearch] = useState("");
  const [odcSource, setOdcSource] = useState<ResumeSourceRecord | null>(null);
  const [managedSource, setManagedSource] = useState<ResumeSourceRecord | null>(null);
  const sources = useQuery({
    queryFn: () =>
      rpcFetch<{ records: ResumeSourceRecord[] }>(
        rpc.api.w[":slug"].studio["resume-sources"].$get({ param: { slug } }),
        "加载简历来源失败",
      ),
    queryKey: ["resume-sources", slug],
  });
  function invalidate() {
    for (const key of [
      "resume-sources",
      "hiring-units",
      "departments",
      "job-descriptions",
      "resumes",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }
  const crud = useEntityCrud<ResumeSourceRecord, ResumeSourceRecord>({
    deleteEntity: (record) =>
      rpc.api.w[":slug"].studio["resume-sources"][":id"].$delete({
        param: { id: record.id, slug },
      }),
    detailFromList: (record) => record,
    invalidate,
    messages: { deleteSuccess: "简历来源已删除" },
  });
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (sources.data?.records ?? []).filter((source) =>
      `${source.name} ${source.description ?? ""}`.toLocaleLowerCase().includes(query),
    );
  }, [search, sources.data]);
  const columns = [
    textColumn<ResumeSourceRecord>({ key: "name", primary: true, title: "简历来源" }),
    textColumn<ResumeSourceRecord>({
      fallback: "—",
      key: "description",
      muted: true,
      title: "描述",
    }),
    customColumn<ResumeSourceRecord>({
      cell: (row) =>
        countCell(
          row,
          "hiringUnit",
          `${row.hiringUnitCount} 个用人组织`,
          canReadUnits && canViewUnitsPage,
        ),
      key: "hiringUnitCount",
      title: "下属用人组织",
    }),
    customColumn<ResumeSourceRecord>({
      cell: (row) =>
        countCell(
          row,
          "department",
          `${row.departmentCount} 个部门`,
          canReadDepartments && canViewDepartmentsPage,
        ),
      key: "departmentCount",
      title: "下属部门",
    }),
    customColumn<ResumeSourceRecord>({
      cell: (row) =>
        countCell(row, "jd", `${row.jobDescriptionCount} 个岗位`, canReadJobs && canViewJobsPage),
      key: "jobDescriptionCount",
      title: "下属岗位",
    }),
    customColumn<ResumeSourceRecord>({
      cell: (row) => <OdcAvatarGroup members={row.odcMembers} />,
      key: "odcMembers",
      title: "ODC",
    }),
    dateColumn<ResumeSourceRecord>({ key: "createdAt", title: "创建时间" }),
    actionsColumn<ResumeSourceRecord>({
      inline: [
        { label: "管理 ODC", onClick: setManagedSource, show: () => canUpdate },
        { label: "编辑", onClick: (row) => void crud.openEdit(row), show: () => canUpdate },
      ],
      menu: [
        { label: "设置 ODC", onClick: setOdcSource, show: () => canUpdate },
        {
          label: "删除",
          onClick: crud.setDeleteRecord,
          show: () => canDelete,
          variant: "destructive",
        },
      ],
    }),
  ];
  return (
    <>
      <div className="mx-auto w-full max-w-[96rem] space-y-6">
        <PageHeader
          title="简历来源"
          description="按“简历来源 → 用人组织 → 部门”组织招聘范围。ODC 在简历来源统一设置，覆盖下属组织和部门，并按序列、服务单位筛选。"
        />
        <DataGrid<ResumeSourceRecord>
          columns={columns}
          data={rows}
          loading={sources.isLoading}
          error={sources.error}
          getRowId={(row) => row.id}
          total={rows.length}
          totalPages={1}
          filterValues={{ search }}
          filters={[{ key: "search", placeholder: "搜索简历来源", type: "search" }]}
          onFilterChange={(_, value) => setSearch(value)}
          onRefresh={() => void sources.refetch()}
          onRetry={() => void sources.refetch()}
          refetching={sources.isRefetching}
          empty={
            <div className="p-10 text-center text-muted-foreground">
              {search
                ? "没有匹配的简历来源"
                : "还没有简历来源。新建后，请在用人组织中选择所属来源。"}
            </div>
          }
          toolbarRight={
            canCreate ? (
              <Button onClick={crud.openCreate}>
                <IconPlus className="size-4" />
                新建简历来源
              </Button>
            ) : null
          }
        />
      </div>
      {(crud.editingRecord ? canUpdate : canCreate) ? (
        <ResumeSourceFormDialog
          open={crud.formDialogOpen}
          onOpenChange={crud.onFormOpenChange}
          record={crud.editingRecord}
          onSaved={invalidate}
        />
      ) : null}
      <OdcAssignmentDialog
        open={canUpdate && odcSource !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOdcSource(null);
          }
        }}
        target={odcSource ? { ...odcSource, rowType: "resumeSource" } : null}
        onSaved={invalidate}
      />
      <OdcManagementModal
        key={managedSource?.id ?? "closed"}
        open={canUpdate && managedSource !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManagedSource(null);
          }
        }}
        target={managedSource ? { ...managedSource, rowType: "resumeSource" } : null}
        onSaved={invalidate}
      />
      {childrenTarget ? (
        <ResumeSourceChildrenModal
          key={`${childrenTarget.kind}:${childrenTarget.source.id}`}
          {...childrenTarget}
          onClose={() => setChildrenTarget(null)}
          onChanged={invalidate}
        />
      ) : null}
      <EntityDeleteDialog
        title="删除简历来源？"
        description={(record) =>
          `即将删除“${record.name}”及其 ODC 配置。请先调整下属用人组织的归属。`
        }
        record={canDelete ? crud.deleteRecord : null}
        onClose={() => crud.setDeleteRecord(null)}
        onConfirm={crud.handleDelete}
      />
    </>
  );
}
