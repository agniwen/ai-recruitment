import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  IconBuilding,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconWorld,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { HiringUnitRecord, HiringUnitTreeResult } from "@arc/shared/hiring-units";
import {
  actionsColumn,
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
} from "@/components/data-grid";
import { DepartmentDeleteDialog } from "@/components/features/studio/departments/department-delete-dialog";
import { DepartmentFormDialog } from "@/components/features/studio/departments/department-form-dialog";
import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";
import { HiringUnitFormDialog } from "@/components/features/studio/hiring-units/hiring-unit-form-dialog";
import { flattenHiringUnitTree } from "@/components/features/studio/hiring-units/hiring-unit-tree";
import type { HiringUnitTreeRow } from "@/components/features/studio/hiring-units/hiring-unit-tree";
import { OdcAssignmentDialog } from "@/components/features/studio/hiring-units/odc-assignment-dialog";
import { PageHeader } from "@/components/features/studio/page-header";
import { useEntityCrud } from "@/components/features/studio/use-entity-crud";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useHasPermission } from "@/hooks/use-has-permission";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function HiringUnitManagementPage() {
  const slug = useWorkspaceSlug();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreateHiringUnit = useHasPermission("hiringUnit", "create");
  const canUpdateHiringUnit = useHasPermission("hiringUnit", "update");
  const canDeleteHiringUnit = useHasPermission("hiringUnit", "delete");
  const canUpdateDepartment = useHasPermission("department", "update");
  const canDeleteDepartment = useHasPermission("department", "delete");
  const [collapsedHiringUnitIds, setCollapsedHiringUnitIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [search, setSearch] = useState("");
  const [odcTarget, setOdcTarget] = useState<HiringUnitTreeRow | null>(null);

  const treeQuery = useQuery({
    queryFn: () =>
      rpcFetch<HiringUnitTreeResult>(
        rpc.api.w[":slug"].studio["hiring-units"].tree.$get({ param: { slug } }),
        "加载用人组织树失败",
      ),
    queryKey: ["hiring-units", slug, "tree"],
  });

  const rows = useMemo(
    () =>
      flattenHiringUnitTree(
        treeQuery.data?.records ?? [],
        collapsedHiringUnitIds,
        search,
        treeQuery.data?.unassignedDepartments ?? [],
      ),
    [collapsedHiringUnitIds, search, treeQuery.data],
  );

  function invalidateHiringUnitData() {
    void queryClient.invalidateQueries({ queryKey: ["hiring-units"] });
    void queryClient.invalidateQueries({ queryKey: ["departments"] });
    void router.invalidate();
  }

  const crud = useEntityCrud<HiringUnitTreeRow, HiringUnitRecord>({
    deleteEntity: (record) =>
      rpc.api.w[":slug"].studio["hiring-units"][":id"].$delete({
        param: { id: record.id, slug },
      }),
    detailFromList: (record) => ({
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      description: record.description,
      id: record.id,
      name: record.name,
      updatedAt: record.updatedAt,
    }),
    invalidate: invalidateHiringUnitData,
    messages: { deleteSuccess: "用人组织已删除" },
  });
  const departmentCrud = useEntityCrud<HiringUnitTreeRow, DepartmentRecord>({
    deleteEntity: (record) =>
      rpc.api.w[":slug"].studio.departments[":id"].$delete({
        param: { id: record.id, slug },
      }),
    detailFromList: (record) => ({
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      description: record.description,
      hiringUnitId: record.parentHiringUnitId,
      hiringUnitName: null,
      id: record.id,
      name: record.name,
      updatedAt: record.updatedAt,
    }),
    invalidate: invalidateHiringUnitData,
    messages: { deleteSuccess: "部门已删除" },
  });

  function toggleHiringUnit(id: string) {
    setCollapsedHiringUnitIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const columns = useMemo(() => {
    const baseColumns = [
      customColumn<HiringUnitTreeRow>({
        cell: (row) => {
          const collapsed = collapsedHiringUnitIds.has(row.id) && !search;
          return (
            <div
              className="flex min-w-56 items-center gap-1"
              style={{ paddingInlineStart: `${row.treeDepth * 24}px` }}
            >
              {row.hasChildren ? (
                <button
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `展开 ${row.name} 的部门` : `收起 ${row.name} 的部门`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => toggleHiringUnit(row.id)}
                  type="button"
                >
                  {collapsed ? (
                    <IconChevronRight className="size-4" />
                  ) : (
                    <IconChevronDown className="size-4" />
                  )}
                </button>
              ) : (
                <span aria-hidden className="size-7 shrink-0" />
              )}
              {row.rowType === "hiringUnit" ? (
                <IconWorld className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <IconBuilding className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <Badge variant={row.rowType === "hiringUnit" ? "secondary" : "outline"}>
                {row.rowType === "hiringUnit" ? "用人组织" : "部门"}
              </Badge>
            </div>
          );
        },
        key: "name",
        title: "组织 / 部门",
      }),
      textColumn<HiringUnitTreeRow>({
        fallback: "—",
        key: "description",
        muted: true,
        title: "描述",
        truncate: true,
      }),
      customColumn<HiringUnitTreeRow>({
        cell: (row) =>
          row.odcMembers.length > 0 ? (
            <AvatarGroup>
              {row.odcMembers.slice(0, 5).map((member) => (
                <Avatar key={member.memberId} size="sm" title={`${member.name} · ${member.email}`}>
                  {member.image ? <AvatarImage alt={member.name} src={member.image} /> : null}
                  <AvatarFallback>{member.name.trim().slice(0, 2) || "ODC"}</AvatarFallback>
                </Avatar>
              ))}
              {row.odcMembers.length > 5 ? (
                <AvatarGroupCount title={`另有 ${row.odcMembers.length - 5} 位 ODC`}>
                  +{row.odcMembers.length - 5}
                </AvatarGroupCount>
              ) : null}
            </AvatarGroup>
          ) : (
            <span className="text-muted-foreground">未设置</span>
          ),
        key: "odcMembers",
        maxSize: 160,
        minSize: 160,
        size: 160,
        title: "ODC",
      }),
      dateColumn<HiringUnitTreeRow>({ key: "createdAt", title: "创建时间" }),
    ];

    if (canUpdateHiringUnit || canDeleteHiringUnit || canUpdateDepartment || canDeleteDepartment) {
      baseColumns.push(
        actionsColumn<HiringUnitTreeRow>({
          inline: [
            {
              label: "编辑",
              onClick: (row) => void crud.openEdit(row),
              show: (row) => row.rowType === "hiringUnit" && canUpdateHiringUnit,
            },
            {
              label: "编辑",
              onClick: (row) => void departmentCrud.openEdit(row),
              show: (row) => row.rowType === "department" && canUpdateDepartment,
            },
          ],
          menu: [
            {
              label: "设置 ODC",
              onClick: setOdcTarget,
              show: (row) =>
                row.rowType === "hiringUnit" ? canUpdateHiringUnit : canUpdateDepartment,
            },
            {
              label: "删除",
              onClick: (row) => crud.setDeleteRecord(row),
              show: (row) => row.rowType === "hiringUnit" && canDeleteHiringUnit,
              variant: "destructive",
            },
            {
              label: "删除",
              onClick: (row) => departmentCrud.setDeleteRecord(row),
              show: (row) => row.rowType === "department" && canDeleteDepartment,
              variant: "destructive",
            },
          ],
        }),
      );
    }
    return baseColumns;
  }, [
    canDeleteDepartment,
    canDeleteHiringUnit,
    canUpdateDepartment,
    canUpdateHiringUnit,
    collapsedHiringUnitIds,
    crud,
    departmentCrud,
    search,
  ]);

  return (
    <>
      <div className="mx-auto w-full max-w-[96rem] space-y-6">
        <PageHeader
          description="按用人组织展开查看所属部门，并设置组织或部门的 ODC。"
          title="用人组织"
        />
        <DataGrid<HiringUnitTreeRow>
          columns={columns}
          data={rows}
          empty={
            <Empty className="border-border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconWorld className="size-5" />
                </EmptyMedia>
                <EmptyTitle>{search ? "没有匹配的组织或部门" : "还没有用人组织"}</EmptyTitle>
                <EmptyDescription>
                  {search
                    ? "请尝试其他关键词。"
                    : "创建用人组织后，可将部门、面试官和在招岗位按业务范围归属起来。"}
                </EmptyDescription>
              </EmptyHeader>
              {canCreateHiringUnit && !search ? (
                <EmptyContent>
                  <Button onClick={crud.openCreate}>
                    <IconPlus className="size-4" />
                    新建用人组织
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          }
          error={treeQuery.error}
          filterValues={{ search }}
          filters={[
            {
              key: "search",
              minWidth: "15rem",
              placeholder: "搜索用人组织或部门",
              type: "search",
            },
          ]}
          getRowId={(row) => `${row.rowType}:${row.id}`}
          loading={treeQuery.isLoading}
          onFilterChange={(_, value) => setSearch(value)}
          onRefresh={() => void treeQuery.refetch()}
          onRetry={() => void treeQuery.refetch()}
          refetching={treeQuery.isRefetching}
          toolbarRight={
            canCreateHiringUnit ? (
              <Button className="flex-1 sm:flex-none" onClick={crud.openCreate}>
                <IconPlus className="size-4" />
                新建用人组织
              </Button>
            ) : null
          }
          total={rows.length}
          totalPages={1}
        />
      </div>

      {canCreateHiringUnit || canUpdateHiringUnit ? (
        <HiringUnitFormDialog
          onOpenChange={crud.onFormOpenChange}
          onSaved={invalidateHiringUnitData}
          open={crud.formDialogOpen}
          record={crud.editingRecord}
        />
      ) : null}

      {canUpdateDepartment && departmentCrud.editingRecord ? (
        <DepartmentFormDialog
          onOpenChange={departmentCrud.onFormOpenChange}
          onSaved={invalidateHiringUnitData}
          open={departmentCrud.formDialogOpen}
          record={departmentCrud.editingRecord}
        />
      ) : null}

      <OdcAssignmentDialog
        onOpenChange={(open) => {
          if (!open) {
            setOdcTarget(null);
          }
        }}
        onSaved={invalidateHiringUnitData}
        open={odcTarget !== null}
        target={odcTarget}
      />

      {canDeleteHiringUnit ? (
        <EntityDeleteDialog
          description={(record) => `即将删除用人组织：${record.name}，删除后无法恢复。`}
          onClose={() => crud.setDeleteRecord(null)}
          onConfirm={crud.handleDelete}
          record={crud.deleteRecord}
          title="确认删除这个用人组织？"
        />
      ) : null}

      <DepartmentDeleteDialog
        onClose={() => departmentCrud.setDeleteRecord(null)}
        onConfirm={departmentCrud.handleDelete}
        record={canDeleteDepartment ? departmentCrud.deleteRecord : null}
      />
    </>
  );
}
