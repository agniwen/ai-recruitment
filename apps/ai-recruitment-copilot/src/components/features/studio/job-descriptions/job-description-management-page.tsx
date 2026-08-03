import { useQueryClient } from "@tanstack/react-query";
import { ClientOnly, useRouter } from "@tanstack/react-router";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import { PageHeader } from "@/components/features/studio/page-header";
import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";
import { useEntityCrud } from "@/components/features/studio/use-entity-crud";
import type {
  JobDescriptionFormValues,
  JobDescriptionListRecord,
  JobDescriptionMetrics,
  JobDescriptionRecord,
} from "@arc/shared/job-descriptions";
import type { PaginatedJobDescriptionResult } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
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
import { useWorkspaceMemberRole, useWorkspaceSlug } from "@/lib/client/workspace-context";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { JobDescriptionFormDialog } from "@/components/features/studio/job-descriptions/job-description-form-dialog";
import { createAiGeneratedJobDescriptionFormValues } from "@/components/features/studio/job-descriptions/job-description-form-values";
import { JobDescriptionAiCreateDialog } from "@/components/features/studio/job-descriptions/job-description-ai-create-dialog";
import { JobDescriptionTalentRecommendationsDialog } from "@/components/features/studio/job-descriptions/job-description-talent-recommendations-dialog";
import { useJobDescriptionDeepLink } from "@/components/features/studio/job-descriptions/use-job-description-deep-link";
import { JobDescriptionToolbarActions } from "@/components/features/studio/job-descriptions/job-description-management-actions";
import { JobDescriptionLongTextHoverCard } from "@/components/features/studio/job-descriptions/job-description-long-text-hover-card";
import { jobDescriptionSourceColumn } from "@/components/features/studio/job-descriptions/job-description-source-column";
import { createJobDescriptionListFilters } from "@/components/features/studio/job-descriptions/job-description-list-filters";
import { useHasPermission } from "@/hooks/use-has-permission";

const salaryAmountFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

interface JobDescriptionFilters extends Record<string, string> {
  code: string;
  departmentId: string;
  googleSheetStatus: string;
  interviewerId: string;
  recruitmentStatus: string;
  sourceSheet: string;
}

function formatSalaryRange(record: JobDescriptionListRecord): string | null {
  if (
    record.salaryCurrency !== null &&
    record.salaryMinAmount !== null &&
    record.salaryMaxAmount !== null
  ) {
    return `${record.salaryCurrency} ${salaryAmountFormatter.format(record.salaryMinAmount)} - ${salaryAmountFormatter.format(record.salaryMaxAmount)}`;
  }
  return record.salaryRangeRaw?.trim() || null;
}

export function JobDescriptionManagementPage({
  departments,
  interviewers,
  metrics,
  recruitmentStatuses,
  sourceSheets,
}: {
  departments: DepartmentRecord[];
  interviewers: InterviewerListRecord[];
  metrics: JobDescriptionMetrics;
  recruitmentStatuses: string[];
  sourceSheets: string[];
}) {
  const slug = useWorkspaceSlug();
  const memberRole = useWorkspaceMemberRole();
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
  const canSyncGoogleSheet = isWorkspaceAdministratorRole(memberRole);

  const fetchJobDescriptions = useCallback(
    (params: {
      signal: AbortSignal;
      search: string;
      page: number;
      pageSize: number;
      filters: JobDescriptionFilters;
      sortBy: string | undefined;
      sortOrder: "asc" | "desc" | undefined;
    }): Promise<PaginatedJobDescriptionResult> =>
      rpcFetch<PaginatedJobDescriptionResult>(
        rpc.api.w[":slug"].studio["job-descriptions"].$get(
          {
            param: { slug },
            query: {
              page: String(params.page),
              pageSize: String(params.pageSize),
              ...(params.search ? { search: params.search } : {}),
              ...(params.filters.code ? { code: params.filters.code } : {}),
              ...(params.filters.sourceSheet ? { sourceSheet: params.filters.sourceSheet } : {}),
              // 多选过滤：CSV 形式，例如 "a,b,c"。空串表示不筛选。
              // / Multi-select filters serialize to CSV; empty string means "no filter".
              ...(params.filters.departmentId ? { departmentId: params.filters.departmentId } : {}),
              ...(params.filters.googleSheetStatus
                ? { googleSheetStatus: params.filters.googleSheetStatus }
                : {}),
              ...(params.filters.interviewerId
                ? { interviewerId: params.filters.interviewerId }
                : {}),
              ...(params.filters.recruitmentStatus
                ? { recruitmentStatus: params.filters.recruitmentStatus }
                : {}),
              sortBy: params.sortBy ?? "createdAt",
              sortOrder: params.sortOrder ?? "desc",
            },
          },
          { init: { signal: params.signal } },
        ),
        "加载在招岗位列表失败",
      ),
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

  const grid = useDataGridState<JobDescriptionListRecord, JobDescriptionFilters>({
    allowedSortIds: ["createdAt", "name", "updatedAt"],
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: {
      code: "",
      departmentId: "",
      googleSheetStatus: "",
      interviewerId: "",
      recruitmentStatus: "",
      sourceSheet: "",
    },
    queryFn: fetchJobDescriptions,
    queryKeyBase: ["job-descriptions", slug],
  });

  const missingRefs = departments.length === 0;

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
    setCreateDraft(
      createAiGeneratedJobDescriptionFormValues({
        departmentId,
        description,
        name,
        prompt,
      }),
    );
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
          r.hiringUnitName ? (
            <span className="block max-w-28 truncate">{r.hiringUnitName}</span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          ),
        key: "hiringUnitName",
        size: 140,
        title: "编制组织",
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
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "controlCategory",
        size: 144,
        title: "岗位管控分类",
        truncate: "max-w-32",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "jobSeries",
        size: 104,
        title: "序列",
        truncate: "max-w-20",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "jobLevel",
        size: 104,
        title: "职级",
        truncate: "max-w-20",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "serviceUnit",
        size: 136,
        title: "服务单位",
        truncate: "max-w-28",
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
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "headcount",
        size: 88,
        title: "HC",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "onboardedCount",
        size: 104,
        title: "已到岗",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "gapCount",
        size: 88,
        title: "缺口",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "offeredPendingOnboardCount",
        size: 152,
        title: "已发offer待入职",
      }),
      dateColumn<JobDescriptionListRecord>({
        emptyText: "—",
        key: "requestedDate",
        options: "YY/MM/DD",
        size: 112,
        title: "提需日期",
      }),
      dateColumn<JobDescriptionListRecord>({
        emptyText: "—",
        key: "expectedOnboardDate",
        options: "YY/MM/DD",
        size: 128,
        title: "期望到岗日期",
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
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "requester",
        size: 128,
        title: "需求发起人",
        truncate: "max-w-24",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "resumeContact",
        size: 168,
        title: "简历对接人（花名 & @TG）",
        truncate: "max-w-36",
      }),
      customColumn<JobDescriptionListRecord>({
        cell: (r) => (
          <JobDescriptionLongTextHoverCard
            label="JD(必填) 岗位职责+任职要求"
            previewClassName="max-w-64 text-muted-foreground"
            value={r.prompt}
          />
        ),
        key: "prompt",
        size: 280,
        title: "JD（岗位职责+任职要求）",
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
        cell: (r) => (
          <JobDescriptionLongTextHoverCard
            label="备注说明\n非远程岗位请备注说明工作地点"
            previewClassName="max-w-64 text-muted-foreground"
            value={r.notes}
          />
        ),
        key: "notes",
        size: 280,
        title: "备注说明（非远程岗位请备注工作地点）",
      }),
      textColumn<JobDescriptionListRecord>({
        fallback: "—",
        key: "sourceSheet",
        size: 136,
        title: "来源表格",
        truncate: "max-w-28",
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
      jobDescriptionSourceColumn,
      customColumn<JobDescriptionListRecord>({
        cell: (r) => {
          if (r.googleSheetDeleted === true) {
            return (
              <Badge className="max-w-24 truncate" variant="danger">
                已删除
              </Badge>
            );
          }
          if (r.googleSheetDeleted === false) {
            return (
              <Badge className="max-w-24 truncate" variant="secondary">
                未删除
              </Badge>
            );
          }
          return <span className="text-muted-foreground text-sm">—</span>;
        },
        key: "googleSheetDeleted",
        size: 120,
        title: "Google 文档",
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
          <JobDescriptionLongTextHoverCard
            label="描述"
            previewClassName="max-w-[13rem] text-muted-foreground text-sm"
            value={r.description}
          />
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
      customColumn<JobDescriptionListRecord>({
        cell: (r) =>
          r.code ? (
            <span className="block max-w-20 truncate font-mono text-xs">{r.code}</span>
          ) : (
            <span className="text-muted-foreground text-sm">未生成</span>
          ),
        key: "code",
        size: 128,
        title: "稳定唯一值",
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
    () =>
      createJobDescriptionListFilters({
        departments,
        interviewers,
        recruitmentStatuses,
        sourceSheets,
      }),
    [departments, interviewers, recruitmentStatuses, sourceSheets],
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
          columnPinning={{ left: ["name", "hiringUnitName"], right: ["code", "actions"] }}
          columns={columns}
          empty={
            missingRefs ? (
              <Empty className="border-border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>请先创建或同步部门</EmptyTitle>
                  <EmptyDescription>
                    在招岗位必须属于一个部门；AI 面试官可以稍后再配置。
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
            <JobDescriptionToolbarActions
              canCreate={canCreateJobDescription}
              canSync={canSyncGoogleSheet}
              missingDepartment={missingRefs}
              onAiCreate={() => setAiCreateOpen(true)}
              onCreate={() => {
                setCreateDraft(null);
                crud.openCreate();
              }}
              onSynced={invalidateJobDescriptionData}
            />
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
