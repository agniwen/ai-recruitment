import { HydrationBoundary, useQueryClient } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useRouter,
} from "@tanstack/react-router";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { parseDataGridSearchParams } from "@/components/data-grid/query-contract";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadStudioHiringUnitsState } from "@/lib/start/studio/hiring-units.functions";
import type { StudioHiringUnitsState } from "@/lib/start/studio/hiring-units.functions";
import { PageHeader } from "@/components/features/studio/page-header";
import { StudioTablePageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";
import { useEntityCrud } from "@/components/features/studio/use-entity-crud";
import type { HiringUnitListRecord, HiringUnitRecord } from "@arc/shared/hiring-units";
import type { PaginatedHiringUnitResult } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";
import { IconWorld as GlobeIcon, IconPlus as PlusIcon } from "@tabler/icons-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  actionsColumn,
  DataGrid,
  dateColumn,
  textColumn,
  useDataGridState,
} from "@/components/data-grid";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { rpc } from "@/lib/client/rpc";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { HiringUnitFormDialog } from "@/components/features/studio/hiring-units/hiring-unit-form-dialog";

function HiringUnitManagementPage() {
  const slug = useWorkspaceSlug();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreateHiringUnit = useHasPermission("hiringUnit", "create");
  const canUpdateHiringUnit = useHasPermission("hiringUnit", "update");
  const canDeleteHiringUnit = useHasPermission("hiringUnit", "delete");

  const fetchHiringUnits = useMemo(
    () =>
      async (params: {
        search: string;
        page: number;
        pageSize: number;
        filters: Record<string, never>;
        sortBy: string | undefined;
        sortOrder: "asc" | "desc" | undefined;
      }): Promise<PaginatedHiringUnitResult> => {
        const res = await rpc.api.w[":slug"].studio["hiring-units"].$get({
          param: { slug },
          query: {
            page: String(params.page),
            pageSize: String(params.pageSize),
            ...(params.search ? { search: params.search } : {}),
            sortBy: params.sortBy ?? "createdAt",
            sortOrder: params.sortOrder ?? "desc",
          },
        });
        if (!res.ok) {
          throw new Error("加载用人组织列表失败");
        }
        return (await res.json()) as PaginatedHiringUnitResult;
      },
    [slug],
  );

  const grid = useDataGridState<HiringUnitListRecord, Record<string, never>>({
    allowedSortIds: ["createdAt", "name", "updatedAt"],
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: {},
    queryFn: fetchHiringUnits,
    queryKeyBase: ["hiring-units", slug],
  });

  function invalidateHiringUnitData() {
    grid.invalidate();
    void queryClient.invalidateQueries({ queryKey: ["hiring-units"] });
    void router.invalidate();
  }

  const crud = useEntityCrud<HiringUnitListRecord, HiringUnitRecord>({
    deleteEntity: (record) =>
      rpc.api.w[":slug"].studio["hiring-units"][":id"].$delete({
        param: { id: record.id, slug },
      }),
    detailFromList: (record) => record,
    invalidate: invalidateHiringUnitData,
    messages: {
      deleteSuccess: "用人组织已删除",
    },
  });

  const columns = useMemo(
    () => {
      const baseColumns = [
        textColumn<HiringUnitListRecord>({
          key: "name",
          primary: true,
          title: "用人组织名称",
        }),
        textColumn<HiringUnitListRecord>({
          fallback: "—",
          key: "description",
          muted: true,
          title: "描述",
          truncate: true,
        }),
        dateColumn<HiringUnitListRecord>({
          key: "createdAt",
          title: "创建时间",
        }),
      ];

      if (canUpdateHiringUnit || canDeleteHiringUnit) {
        baseColumns.push(
          actionsColumn<HiringUnitListRecord>({
            inline: [
              {
                label: "编辑",
                onClick: (r) => void crud.openEdit(r),
                show: () => canUpdateHiringUnit,
              },
            ],
            menu: [
              {
                label: "删除",
                onClick: (r) => crud.setDeleteRecord(r),
                show: () => canDeleteHiringUnit,
                variant: "destructive",
              },
            ],
          }),
        );
      }

      return baseColumns;
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- columns 不应每次 crud 引用变化都重建
    [canDeleteHiringUnit, canUpdateHiringUnit],
  );

  const filtersConfig = useMemo(
    () => [
      {
        key: "search" as const,
        minWidth: "15rem",
        placeholder: "搜索用人组织名称或描述",
        type: "search" as const,
      },
    ],
    [],
  );

  return (
    <>
      <div className="mx-auto w-full max-w-[96rem] space-y-6">
        <PageHeader
          description="维护业务侧承担招聘需求的用人组织。后续招聘组可按用人组织划分负责范围。"
          title="用人组织"
        />

        <DataGrid<HiringUnitListRecord>
          {...grid.bind}
          columns={columns}
          empty={
            <Empty className="border-border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GlobeIcon className="size-5" />
                </EmptyMedia>
                <EmptyTitle>还没有用人组织</EmptyTitle>
                <EmptyDescription>
                  创建用人组织后，可逐步把部门、面试官和在招岗位按业务范围归属起来。
                </EmptyDescription>
              </EmptyHeader>
              {canCreateHiringUnit ? (
                <EmptyContent>
                  <Button onClick={crud.openCreate}>
                    <PlusIcon className="size-4" />
                    新建用人组织
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          }
          filters={filtersConfig}
          getRowId={(r) => r.id}
          toolbarRight={
            canCreateHiringUnit ? (
              <Button className="flex-1 sm:flex-none" onClick={crud.openCreate}>
                <PlusIcon className="size-4" />
                新建用人组织
              </Button>
            ) : null
          }
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

      {canDeleteHiringUnit ? (
        <EntityDeleteDialog
          description={(record) => `即将删除用人组织：${record.name}，删除后无法恢复。`}
          onClose={() => crud.setDeleteRecord(null)}
          onConfirm={crud.handleDelete}
          record={crud.deleteRecord}
          title="确认删除这个用人组织？"
        />
      ) : null}
    </>
  );
}

type EmptyFilters = Record<string, never>;
type SearchParamsPrimitive = boolean | number | string;
type SearchParamsRecord = Record<
  string,
  SearchParamsPrimitive | SearchParamsPrimitive[] | undefined
>;
function coerceSearchParams(search: Record<string, unknown>): SearchParamsRecord {
  const out: SearchParamsRecord = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (item): item is boolean | number | string =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
    }
  }
  return out;
}

function parseHiringUnitQuery(searchParams: SearchParamsRecord): DataGridQueryState<EmptyFilters> {
  return parseDataGridSearchParams(searchParams, {
    allowedSortIds: ["createdAt", "name", "updatedAt"],
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: {},
  });
}

function StudioHiringUnitsRoute() {
  const state = useLoaderData({
    from: "/w/$slug/studio/hiring-units",
  }) as unknown as StudioHiringUnitsState;

  if (state.status !== "ready") {
    return null;
  }

  return (
    <HydrationBoundary state={state.dehydratedState as unknown as DehydratedState}>
      <HiringUnitManagementPage />
    </HydrationBoundary>
  );
}

export const Route = createFileRoute("/w/$slug/studio/hiring-units")({
  component: StudioHiringUnitsRoute,
  head: () => ({
    meta: [{ title: formatDocumentTitle("用人组织管理") }],
  }),
  loader: async (loaderContext) => {
    const { location, params } = loaderContext as unknown as {
      location: { search: SearchParamsRecord };
      params: { slug: string };
    };
    const query = parseHiringUnitQuery(location.search);
    const state = (await loadStudioHiringUnitsState({
      data: { query, slug: params.slug },
    })) as StudioHiringUnitsState;
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(`/w/${params.slug}/studio/hiring-units`)}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  pendingComponent: () => <StudioTablePageSkeleton label="用人组织管理" />,
  shouldReload: false,
  validateSearch: (search: Record<string, unknown>) => coerceSearchParams(search),
});
