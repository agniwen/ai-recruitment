import { HydrationBoundary, useQueryClient } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
import {
  ClientOnly,
  createFileRoute,
  notFound,
  redirect,
  useLoaderData,
  useRouter,
} from "@tanstack/react-router";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import { parseDataGridSearchParams } from "@/components/data-grid/query-contract";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import { formatDocumentTitle } from "@/lib/start/document-title";
import { loadStudioJobDescriptionsState } from "@/lib/start/studio/job-descriptions.functions";
import type { StudioJobDescriptionsState } from "@/lib/start/studio/job-descriptions.functions";
import { requireStudioPageAccess } from "@/lib/start/studio/page-access";
import { PageHeader } from "@/components/features/studio/page-header";
import { JobDescriptionsPageSkeleton } from "@/components/features/studio/studio-page-skeletons";
import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";
import { useEntityCrud } from "@/components/features/studio/use-entity-crud";
import type {
  JobDescriptionFormValues,
  JobDescriptionListRecord,
  JobDescriptionMetrics,
  JobDescriptionRecord,
} from "@arc/shared/job-descriptions";
import { createDefaultResumeScreeningPolicy } from "@arc/shared/job-descriptions";
import type { PaginatedJobDescriptionResult } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";
import { JobDescriptionCharts } from "@/components/features/studio/job-descriptions/job-description-charts";
import { ScopedResumesModal } from "@/components/features/studio/scoped-resumes-modal";
import {
  IconFileText as FileTextIcon,
  IconPlus as PlusIcon,
  IconSparkles as SparklesIcon,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  actionsColumn,
  customColumn,
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
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { JobDescriptionFormDialog } from "@/components/features/studio/job-descriptions/job-description-form-dialog";
import { JobDescriptionAiCreateDialog } from "@/components/features/studio/job-descriptions/job-description-ai-create-dialog";
import { JobDescriptionTalentRecommendationsDialog } from "@/components/features/studio/job-descriptions/job-description-talent-recommendations-dialog";
import { useJobDescriptionDeepLink } from "@/components/features/studio/job-descriptions/use-job-description-deep-link";
import { useHasPermission } from "@/hooks/use-has-permission";

const salaryAmountFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

function formatSalaryRange(record: JobDescriptionListRecord): string | null {
  if (
    record.salaryCurrency === null ||
    record.salaryMinAmount === null ||
    record.salaryMaxAmount === null
  ) {
    return null;
  }
  return `${record.salaryCurrency} ${salaryAmountFormatter.format(record.salaryMinAmount)} - ${salaryAmountFormatter.format(record.salaryMaxAmount)}`;
}

function formatHeadcount(record: JobDescriptionListRecord): string | null {
  if (
    record.headcount === null &&
    record.onboardedCount === null &&
    record.gapCount === null &&
    record.offeredPendingOnboardCount === null
  ) {
    return null;
  }
  const headcount = record.headcount ?? "-";
  const gap = record.gapCount ?? "-";
  const onboarded = record.onboardedCount ?? "-";
  const offered = record.offeredPendingOnboardCount ?? "-";
  return `HC ${headcount} / 缺口 ${gap} / 到岗 ${onboarded} / offer ${offered}`;
}

function JobDescriptionManagementPage({
  departments,
  interviewers,
  metrics,
}: {
  departments: DepartmentRecord[];
  interviewers: InterviewerListRecord[];
  metrics: JobDescriptionMetrics;
}) {
  const slug = useWorkspaceSlug();
  const router = useRouter();
  const queryClient = useQueryClient();
  // 当前点开"简历关联"的那条 JD；null 表示弹窗关闭。
  // The JD whose associated resumes are being inspected; null = closed.
  const [resumesScope, setResumesScope] = useState<{ id: string; name: string } | null>(null);
  const [recommendationScope, setRecommendationScope] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [createDraft, setCreateDraft] = useState<JobDescriptionFormValues | null>(null);
  const [createDraftSessionId, setCreateDraftSessionId] = useState(0);
  const [aiCreateOpen, setAiCreateOpen] = useState(false);
  const canCreateJobDescription = useHasPermission("jd", "create");
  const canUpdateJobDescription = useHasPermission("jd", "update");
  const canDeleteJobDescription = useHasPermission("jd", "delete");
  const canReadResumeLibrary = useHasPermission("resumeLibrary", "read");

  const fetchJobDescriptions = useCallback(
    async (params: {
      search: string;
      page: number;
      pageSize: number;
      filters: { departmentId: string; interviewerId: string };
      sortBy: string | undefined;
      sortOrder: "asc" | "desc" | undefined;
    }): Promise<PaginatedJobDescriptionResult> => {
      const res = await rpc.api.w[":slug"].studio["job-descriptions"].$get({
        param: { slug },
        query: {
          page: String(params.page),
          pageSize: String(params.pageSize),
          ...(params.search ? { search: params.search } : {}),
          // 多选过滤：CSV 形式，例如 "a,b,c"。空串表示不筛选。
          // / Multi-select filters serialize to CSV; empty string means "no filter".
          ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
          ...(params.filters.interviewerId ? { interviewerId: params.filters.interviewerId } : {}),
          sortBy: params.sortBy ?? "createdAt",
          sortOrder: params.sortOrder ?? "desc",
        },
      });
      if (!res.ok) {
        throw new Error("加载在招岗位列表失败");
      }
      return (await res.json()) as PaginatedJobDescriptionResult;
    },
    [slug],
  );

  const loadJobDescriptionDetail = useCallback(
    async (record: JobDescriptionListRecord): Promise<JobDescriptionRecord | null> => {
      const response = await rpc.api.w[":slug"].studio["job-descriptions"][":id"].$get({
        param: { id: record.id, slug },
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as JobDescriptionRecord;
    },
    [slug],
  );

  const grid = useDataGridState<
    JobDescriptionListRecord,
    { departmentId: string; interviewerId: string }
  >({
    allowedSortIds: ["createdAt", "name", "updatedAt"],
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: { departmentId: "", interviewerId: "" },
    queryFn: fetchJobDescriptions,
    queryKeyBase: ["job-descriptions", slug],
  });

  const missingRefs = departments.length === 0 || interviewers.length === 0;

  function invalidateJobDescriptionData() {
    grid.invalidate();
    void queryClient.invalidateQueries({ queryKey: ["job-descriptions"] });
    void queryClient.invalidateQueries({ queryKey: ["interviewers"] });
    void queryClient.invalidateQueries({ queryKey: ["departments"] });
    void queryClient.invalidateQueries({ queryKey: ["studio-resumes", slug] });
    void queryClient.invalidateQueries({ queryKey: ["studio-interviews", slug] });
    void router.invalidate();
  }

  const crud = useEntityCrud<JobDescriptionListRecord, JobDescriptionRecord>({
    deleteEntity: (record) =>
      rpc.api.w[":slug"].studio["job-descriptions"][":id"].$delete({
        param: { id: record.id, slug },
      }),
    invalidate: invalidateJobDescriptionData,
    loadDetail: loadJobDescriptionDetail,
    messages: {
      deleteSuccess: "在招岗位已删除",
      loadDetailError: "加载在招岗位失败",
    },
  });

  useJobDescriptionDeepLink(crud.openEdit);

  function onFormOpenChange(next: boolean) {
    crud.onFormOpenChange(next);
    if (!next) {
      setCreateDraft(null);
    }
  }

  function handleAiGenerated({
    departmentId,
    description,
    name,
    prompt,
  }: {
    departmentId: string;
    description: string;
    name: string;
    prompt: string;
  }) {
    if (!canCreateJobDescription) {
      return;
    }
    setCreateDraft({
      aiInterviewDisabled: false,
      allowCrossDepartmentInterviewers: false,
      controlCategory: null,
      departmentId,
      description,
      expectedOnboardDate: null,
      gapCount: null,
      headcount: null,
      humanInterviewerIds: [],
      interviewerIds: [],
      jobLevel: null,
      jobSeries: null,
      name,
      notes: null,
      offeredPendingOnboardCount: null,
      onboardedCount: null,
      priority: "P0",
      prompt,
      recruitmentStatus: null,
      requestedDate: null,
      requester: null,
      resumeContact: null,
      resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
      salaryCurrency: null,
      salaryMaxAmount: null,
      salaryMinAmount: null,
      serviceUnit: null,
      sourceSheet: null,
      workEndTime: null,
      workLocation: null,
      workStartTime: null,
      workTimezone: null,
    });
    setCreateDraftSessionId((id) => id + 1);
    crud.setEditingRecord(null);
    crud.setFormDialogOpen(true);
  }

  let editorDialogKey = "create-empty";
  if (createDraft) {
    editorDialogKey = `create-draft-${createDraftSessionId}`;
  } else if (crud.editingRecord) {
    editorDialogKey = `edit-${crud.editingRecord.id}`;
  }
  const canOpenEditorDialog = crud.editingRecord
    ? canUpdateJobDescription
    : canCreateJobDescription;

  const columns = useMemo(
    () => [
      textColumn<JobDescriptionListRecord>({
        key: "name",
        primary: true,
        size: 220,
        title: "岗位名称",
        truncate: "max-w-[11.75rem]",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) =>
          r.code ? (
            <span className="block max-w-20 truncate font-mono text-xs">{r.code}</span>
          ) : (
            <span className="text-muted-foreground text-sm">未生成</span>
          ),
        key: "code",
        size: 112,
        title: "编码",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) =>
          r.departmentName ? (
            <span className="block max-w-24 truncate">{r.departmentName}</span>
          ) : (
            <Badge variant="outline">未知</Badge>
          ),
        key: "departmentName",
        size: 128,
        title: "部门",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) =>
          r.recruitmentStatus ? (
            <Badge className="max-w-24 truncate" variant="secondary">
              {r.recruitmentStatus}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
        key: "recruitmentStatus",
        size: 120,
        title: "招聘状态",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) =>
          r.priority ? (
            <span className="block max-w-14 truncate">{r.priority}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
        key: "priority",
        size: 88,
        title: "优先级",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) => {
          const salary = formatSalaryRange(r);
          return salary ? (
            <span className="block max-w-[8.5rem] truncate font-mono text-sm">{salary}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          );
        },
        key: "salary",
        size: 168,
        title: "薪资范围",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) => {
          const headcount = formatHeadcount(r);
          return headcount ? (
            <span className="block max-w-[10.5rem] truncate text-sm">{headcount}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          );
        },
        key: "headcount",
        size: 200,
        title: "HC/缺口",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) =>
          r.workLocation ? (
            <span className="block max-w-24 truncate">{r.workLocation}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
        key: "workLocation",
        size: 128,
        title: "工作地点",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) => {
          if (r.interviewers.length === 0) {
            return <Badge variant="outline">未配置</Badge>;
          }
          return (
            <div className="flex max-w-[8.5rem] flex-wrap gap-1">
              {r.interviewers.slice(0, 3).map((item) => (
                <Badge key={item.id} variant="secondary">
                  {item.name}
                </Badge>
              ))}
              {r.interviewers.length > 3 ? (
                <Badge variant="outline">+{r.interviewers.length - 3}</Badge>
              ) : null}
            </div>
          );
        },
        key: "interviewers",
        size: 168,
        title: "AI面试官",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) => {
          if (r.resumeCount === 0) {
            return <span className="text-muted-foreground text-sm">关联了 0 个简历</span>;
          }
          if (!canReadResumeLibrary) {
            return (
              <span className="text-muted-foreground text-sm">关联了 {r.resumeCount} 个简历</span>
            );
          }
          return (
            <Button
              className="h-auto p-0 font-medium text-primary"
              onClick={() => setResumesScope({ id: r.id, name: r.name })}
              type="button"
              variant="link"
            >
              关联了 {r.resumeCount} 个简历
            </Button>
          );
        },
        key: "resumeCount",
        size: 128,
        title: "简历关联",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) => (
          <span className="block max-w-[13rem] truncate text-muted-foreground text-sm">
            {r.description || "—"}
          </span>
        ),
        key: "description",
        size: 240,
        title: "描述",
      }),
      dateColumn<JobDescriptionListRecord>({
        key: "createdAt",
        size: 128,
        title: "创建时间",
      }),
      actionsColumn<JobDescriptionListRecord>({
        inline: [
          {
            label: "推荐",
            onClick: (r) => {
              setRecommendationScope({ id: r.id, name: r.name });
            },
            show: () => canReadResumeLibrary,
          },
          {
            label: "编辑",
            onClick: (r) => {
              void crud.openEdit(r);
            },
            show: () => canUpdateJobDescription,
          },
        ],
        menu: [
          {
            label: "删除",
            onClick: (r) => crud.setDeleteRecord(r),
            show: () => canDeleteJobDescription,
            variant: "destructive",
          },
        ],
        size: 168,
      }),
    ],
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [canDeleteJobDescription, canReadResumeLibrary, canUpdateJobDescription],
  );

  const filtersConfig = useMemo(
    () => [
      {
        key: "search" as const,
        minWidth: "15rem",
        placeholder: "搜索在招岗位名称或描述",
        type: "search" as const,
      },
      {
        emptyMessage: "没有匹配的部门",
        key: "departmentId" as const,
        options: departments.map((d) => ({ label: d.name, value: d.id })),
        placeholder: "全部部门",
        searchPlaceholder: "搜索部门…",
        selectedFormat: (count: number) => `已选 ${count} 个部门`,
        type: "multi-select" as const,
      },
      {
        emptyMessage: "没有匹配的 AI面试官",
        key: "interviewerId" as const,
        options: interviewers.map((i) => ({
          description: i.departmentName ?? "未知部门",
          label: i.name,
          value: i.id,
        })),
        placeholder: "全部 AI面试官",
        searchPlaceholder: "搜索 AI面试官…",
        selectedFormat: (count: number) => `已选 ${count} 位 AI面试官`,
        type: "multi-select" as const,
      },
    ],
    [departments, interviewers],
  );

  return (
    <>
      <div className="mx-auto w-full max-w-[96rem] space-y-6">
        <PageHeader
          description="维护在招岗位、JD 和要求；候选人、面试官和面试都会挂到对应岗位上。"
          title="岗位设置"
        />

        <ClientOnly fallback={<Skeleton className="h-80 w-full" />}>
          <JobDescriptionCharts metrics={metrics} />
        </ClientOnly>

        <DataGrid<JobDescriptionListRecord>
          {...grid.bind}
          columnPinning={{ right: ["actions"] }}
          columns={columns}
          empty={
            missingRefs ? (
              <Empty className="border-border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>请先创建部门和面试官</EmptyTitle>
                  <EmptyDescription>
                    在招岗位需要同时指定部门和面试官，先去对应页面完成配置。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Empty className="border-border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>还没有在招岗位</EmptyTitle>
                  <EmptyDescription>
                    创建在招岗位之后即可在面试记录中引用，并带上面试官 prompt 与音色。
                  </EmptyDescription>
                </EmptyHeader>
                {canCreateJobDescription ? (
                  <EmptyContent className="flex items-center justify-center">
                    <ButtonGroup>
                      <Button
                        disabled={missingRefs}
                        onClick={() => {
                          setCreateDraft(null);
                          crud.openCreate();
                        }}
                      >
                        <PlusIcon className="size-4" />
                        新建在招岗位
                      </Button>
                      <Button
                        aria-label="AI 创建在招岗位"
                        disabled={missingRefs}
                        onClick={() => setAiCreateOpen(true)}
                        size="icon"
                        title="AI 创建在招岗位"
                        type="button"
                      >
                        <SparklesIcon className="size-4" />
                      </Button>
                    </ButtonGroup>
                  </EmptyContent>
                ) : null}
              </Empty>
            )
          }
          filters={filtersConfig}
          getRowId={(r) => r.id}
          toolbarRight={
            canCreateJobDescription ? (
              <ButtonGroup className="flex-1 sm:flex-none">
                <Button
                  className="flex-1 sm:flex-none"
                  disabled={missingRefs}
                  onClick={() => {
                    setCreateDraft(null);
                    crud.openCreate();
                  }}
                >
                  <PlusIcon className="size-4" />
                  新建在招岗位
                </Button>
                <Button
                  aria-label="AI 创建在招岗位"
                  disabled={missingRefs}
                  onClick={() => setAiCreateOpen(true)}
                  size="icon"
                  title="AI 创建在招岗位"
                  type="button"
                >
                  <SparklesIcon className="size-4" />
                </Button>
              </ButtonGroup>
            ) : null
          }
        />
      </div>

      {canCreateJobDescription ? (
        <JobDescriptionAiCreateDialog
          departments={departments}
          onGenerated={handleAiGenerated}
          onOpenChange={setAiCreateOpen}
          open={aiCreateOpen}
        />
      ) : null}

      {canOpenEditorDialog ? (
        <JobDescriptionFormDialog
          departments={departments}
          initialDraft={createDraft}
          interviewers={interviewers}
          key={editorDialogKey}
          onOpenChange={onFormOpenChange}
          onSaved={invalidateJobDescriptionData}
          open={crud.formDialogOpen}
          record={crud.editingRecord}
        />
      ) : null}

      <EntityDeleteDialog
        confirmDisabled={(record) => record.resumeCount > 0}
        description={(record) => {
          if (record.resumeCount > 0) {
            return `当前有 ${record.resumeCount} 条简历关联到岗位「${record.name}」，无法删除；请先到简历库取消关联或删除这些候选人。`;
          }
          return `即将删除岗位：${record.name}，引用该岗位的面试记录的关联岗位字段会被清空。`;
        }}
        onClose={() => crud.setDeleteRecord(null)}
        onConfirm={crud.handleDelete}
        record={canDeleteJobDescription ? crud.deleteRecord : null}
        title="确认删除这个在招岗位？"
      />

      <ScopedResumesModal
        jobDescription={resumesScope}
        onOpenChange={(next) => {
          if (!next) {
            setResumesScope(null);
          }
        }}
        open={canReadResumeLibrary && resumesScope !== null}
      />

      <JobDescriptionTalentRecommendationsDialog
        jobDescription={recommendationScope}
        onOpenChange={(next) => {
          if (!next) {
            setRecommendationScope(null);
          }
        }}
        open={canReadResumeLibrary && recommendationScope !== null}
      />
    </>
  );
}

interface JobDescriptionFilters extends Record<string, string> {
  departmentId: string;
  interviewerId: string;
}

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

function parseJobDescriptionQuery(
  searchParams: SearchParamsRecord,
): DataGridQueryState<JobDescriptionFilters> {
  return parseDataGridSearchParams(searchParams, {
    allowedSortIds: ["createdAt", "name", "updatedAt"],
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: { departmentId: "", interviewerId: "" },
  });
}

function StudioJobDescriptionsRoute() {
  const state = useLoaderData({
    from: "/w/$slug/studio/job-descriptions",
  }) as unknown as StudioJobDescriptionsState;

  if (state.status !== "ready") {
    return null;
  }

  return (
    <HydrationBoundary state={state.dehydratedState as unknown as DehydratedState}>
      <JobDescriptionManagementPage
        departments={state.departments}
        interviewers={state.interviewers}
        metrics={state.metrics}
      />
    </HydrationBoundary>
  );
}

export const Route = createFileRoute("/w/$slug/studio/job-descriptions")({
  validateSearch: (search: Record<string, unknown>) => coerceSearchParams(search),
  loader: async (loaderContext) => {
    const { location, params } = loaderContext as unknown as {
      location: { search: SearchParamsRecord };
      params: { slug: string };
    };
    const query = parseJobDescriptionQuery(location.search);
    await requireStudioPageAccess({
      action: "jobDescriptions",
      pathname: `/w/${params.slug}/studio/job-descriptions`,
      slug: params.slug,
    });
    const state = (await loadStudioJobDescriptionsState({
      data: { query, slug: params.slug },
    })) as StudioJobDescriptionsState;
    if (state.status === "unauthenticated") {
      throw redirect({
        href: `/login?callbackURL=${encodeURIComponent(
          `/w/${params.slug}/studio/job-descriptions`,
        )}`,
      });
    }
    if (state.status === "not_found") {
      throw notFound();
    }
    return state;
  },
  head: () => ({
    meta: [{ title: formatDocumentTitle("岗位设置") }],
  }),
  component: StudioJobDescriptionsRoute,
  pendingComponent: JobDescriptionsPageSkeleton,
  shouldReload: false,
});
