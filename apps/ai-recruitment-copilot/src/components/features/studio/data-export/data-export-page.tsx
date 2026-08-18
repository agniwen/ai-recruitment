/* oxlint-disable max-lines complexity -- export page keeps the two source-specific table controllers together. */
"use client";

import { IconDownload, IconFileSpreadsheet } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ResumePoolScope } from "@arc/db-schema/schema";
import {
  candidateOutcomeMeta,
  pipelineStageMeta,
  resumeParseStatusMeta,
} from "@arc/db-schema/studio-interviews";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import type { ResumePoolListRecord } from "@arc/shared/resume-pool";
import { describeResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import { parseCsvParam } from "@arc/shared/csv";
import { formatDate } from "@arc/shared/utils/time";
import {
  DataGrid,
  badgeColumn,
  dateColumn,
  textColumn,
  useDataGridState,
} from "@/components/data-grid";
import type { ToolbarFilterConfig } from "@/components/data-grid";
import { PageHeader } from "@/components/features/studio/page-header";
import {
  buildResumePoolUploaderFilterOptions,
  getResumePoolUploaderFilterAvailability,
  sourceLabel,
} from "@/components/features/studio/resume-pool/resume-pool-page-model";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  fetchResumePoolItems,
  fetchResumePoolUploaders,
  fetchStudioResumeSkillSuggestions,
  fetchStudioResumes,
  rpcFetch,
} from "@/lib/client/api";
import { fetchSelectableHiringUnits } from "@/lib/client/api/endpoints/hiring-units";
import { authClient } from "@/lib/client/auth-client";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { useHasPermission } from "@/hooks/use-has-permission";
import { DataExportDialog } from "./data-export-dialog";
import { DATA_EXPORT_LIMIT, DATA_EXPORT_PAGE_SIZE } from "./data-export-model";
import type { DataExportColumn, DataExportSource } from "./data-export-model";

interface CandidateExportFilters extends Record<string, string> {
  candidateEmail: string;
  candidateName: string;
  candidatePhone: string;
  creatorIds: string;
  hiringUnitId: string;
  id: string;
  jdIds: string;
  skills: string;
  stage: string;
}

interface PoolExportFilters extends Record<string, string> {
  id: string;
  importStatus: string;
  parseStatus: string;
  scope: string;
  sourceType: string;
  uploaderId: string;
}

interface WorkspaceMember {
  email: string;
  id: string;
  image: string | null;
  name: string;
}

const CANDIDATE_FILTERS: CandidateExportFilters = {
  candidateEmail: "",
  candidateName: "",
  candidatePhone: "",
  creatorIds: "",
  hiringUnitId: "",
  id: "",
  jdIds: "",
  skills: "",
  stage: "",
};

const POOL_FILTERS: PoolExportFilters = {
  id: "",
  importStatus: "",
  parseStatus: "",
  scope: "public",
  sourceType: "all",
  uploaderId: "",
};

function displayDate(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const formatted = formatDate(value);
  return formatted === "—" ? "" : formatted;
}

const candidateExportColumns: readonly DataExportColumn<ResumeLibraryListRecord>[] = [
  { id: "id", label: "候选人ID", value: (row) => row.id, width: 24 },
  { id: "candidateName", label: "候选人姓名", value: (row) => row.candidateName, width: 16 },
  { id: "candidateEmail", label: "邮箱", value: (row) => row.candidateEmail, width: 28 },
  { id: "candidatePhone", label: "电话", value: (row) => row.candidatePhone, width: 18 },
  {
    id: "pipelineStage",
    label: "招聘阶段",
    value: (row) => pipelineStageMeta[row.pipelineStage].label,
  },
  { id: "outcome", label: "候选人状态", value: (row) => candidateOutcomeMeta[row.outcome].label },
  {
    id: "jobDescriptionName",
    label: "关联岗位",
    value: (row) => row.jobDescriptionName,
    width: 24,
  },
  { id: "hiringUnitName", label: "用人组织", value: (row) => row.hiringUnitName, width: 20 },
  { id: "targetRole", label: "目标岗位", value: (row) => row.targetRole, width: 20 },
  { id: "resumeSkills", label: "技能", value: (row) => row.resumeSkills.join("、"), width: 36 },
  {
    id: "recruitmentSource",
    label: "招聘来源",
    value: (row) =>
      describeResumeRecruitmentSource(row.recruitmentSource, row.recruitmentSourceDetail),
    width: 20,
  },
  { id: "creatorName", label: "创建人", value: (row) => row.creatorName, width: 16 },
  { id: "createdAt", label: "创建时间", value: (row) => displayDate(row.createdAt), width: 22 },
  { id: "updatedAt", label: "更新时间", value: (row) => displayDate(row.updatedAt), width: 22 },
  { id: "notes", label: "备注", value: (row) => row.notes, width: 40 },
];

const candidateDefaultColumnIds = [
  "candidateName",
  "candidateEmail",
  "candidatePhone",
  "pipelineStage",
  "jobDescriptionName",
  "hiringUnitName",
  "creatorName",
  "createdAt",
] as const;

const poolExportColumns: readonly DataExportColumn<ResumePoolListRecord>[] = [
  { id: "id", label: "简历ID", value: (row) => row.id, width: 24 },
  {
    id: "scope",
    label: "简历池范围",
    value: (row) => (row.scope === "private" ? "私有简历池" : "公共简历池"),
  },
  { id: "candidateName", label: "候选人姓名", value: (row) => row.candidateName, width: 16 },
  { id: "candidateEmail", label: "邮箱", value: (row) => row.candidateEmail, width: 28 },
  { id: "candidatePhone", label: "电话", value: (row) => row.candidatePhone, width: 18 },
  { id: "targetRole", label: "目标岗位", value: (row) => row.targetRole, width: 20 },
  {
    id: "jobDescriptionName",
    label: "关联岗位",
    value: (row) => row.jobDescriptionName,
    width: 24,
  },
  { id: "resumeFileName", label: "简历文件", value: (row) => row.resumeFileName, width: 32 },
  {
    id: "resumeParseStatus",
    label: "解析状态",
    value: (row) => resumeParseStatusMeta[row.resumeParseStatus].label,
  },
  {
    id: "importStatus",
    label: "入库状态",
    value: (row) => (row.importedResumeRecordId ? "已入库" : "未入库"),
  },
  { id: "source", label: "来源类型", value: sourceLabel, width: 18 },
  {
    id: "recruitmentSource",
    label: "招聘来源",
    value: (row) =>
      describeResumeRecruitmentSource(row.recruitmentSource, row.recruitmentSourceDetail),
    width: 20,
  },
  {
    id: "uploaderName",
    label: "上传人",
    value: (row) => row.uploaderName ?? row.uploaderEmail,
    width: 18,
  },
  { id: "masteredSkills", label: "技能", value: (row) => row.masteredSkills.join("、"), width: 36 },
  { id: "createdAt", label: "创建时间", value: (row) => displayDate(row.createdAt), width: 22 },
  { id: "updatedAt", label: "更新时间", value: (row) => displayDate(row.updatedAt), width: 22 },
  { id: "notes", label: "备注", value: (row) => row.notes, width: 40 },
];

const poolDefaultColumnIds = [
  "candidateName",
  "candidateEmail",
  "candidatePhone",
  "targetRole",
  "resumeParseStatus",
  "importStatus",
  "source",
  "uploaderName",
  "createdAt",
] as const;

function ExportButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <Button disabled={disabled} onClick={onClick}>
      <IconDownload data-icon="inline-start" />
      导出
    </Button>
  );
}

function ExportEmpty({ label }: { label: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileSpreadsheet />
        </EmptyMedia>
        <EmptyTitle>没有符合筛选条件的{label}</EmptyTitle>
        <EmptyDescription>调整或重置筛选条件后再试。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function CandidateExportTable() {
  const slug = useWorkspaceSlug();
  const canExportData = useHasPermission("dataExport", "export");
  const [dialogOpen, setDialogOpen] = useState(false);
  const membersQuery = useQuery({
    queryFn: () =>
      rpcFetch<{ records: WorkspaceMember[] }>(
        rpc.api.w[":slug"].studio.workspace.members.$get({ param: { slug } }),
        "加载成员列表失败",
      ),
    queryKey: ["workspace-members", slug],
    staleTime: 60_000,
  });
  const jobsQuery = useQuery({
    queryFn: async () => {
      const response = await rpc.api.w[":slug"].studio["job-descriptions"].all.$get({
        param: { slug },
      });
      if (!response.ok) {
        throw new Error("加载在招岗位列表失败");
      }
      const payload = await response.json();
      return payload.records;
    },
    queryKey: ["job-descriptions", "all", slug],
    staleTime: 60_000,
  });
  const hiringUnitsQuery = useQuery({
    queryFn: () => fetchSelectableHiringUnits(slug),
    queryKey: ["hiring-units", "selectable", slug],
    staleTime: 60_000,
  });
  const skillsQuery = useQuery({
    queryFn: async () => {
      const result = await fetchStudioResumeSkillSuggestions(slug, { limit: 100 });
      return result.records;
    },
    queryKey: ["studio-resumes", "skill-suggestions", slug],
    staleTime: 60_000,
  });

  const fetchRows = useMemo(
    () =>
      ({
        filters,
        page,
        pageSize,
        signal,
        sortBy,
        sortOrder,
      }: {
        filters: CandidateExportFilters;
        page: number;
        pageSize: number;
        signal?: AbortSignal;
        sortBy?: string;
        sortOrder?: "asc" | "desc";
      }) =>
        fetchStudioResumes(
          slug,
          {
            candidateEmail: filters.candidateEmail || undefined,
            candidateName: filters.candidateName || undefined,
            candidatePhone: filters.candidatePhone || undefined,
            creatorIds: parseCsvParam(filters.creatorIds),
            hiringUnitId: filters.hiringUnitId || undefined,
            id: filters.id || undefined,
            jobDescriptionIds: parseCsvParam(filters.jdIds),
            page,
            pageSize,
            pipelineStages: parseCsvParam(filters.stage),
            skills: parseCsvParam(filters.skills),
            sortBy,
            sortOrder,
          },
          { signal },
        ),
    [slug],
  );
  const grid = useDataGridState<ResumeLibraryListRecord, CandidateExportFilters>({
    allowedSortIds: ["createdAt", "candidateName", "updatedAt"],
    defaultPageSize: DATA_EXPORT_PAGE_SIZE,
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: CANDIDATE_FILTERS,
    maxPageSize: DATA_EXPORT_PAGE_SIZE,
    queryFn: (params) => fetchRows(params),
    queryKeyBase: ["studio-data-export", "candidates", slug],
  });
  const filters = useMemo<ToolbarFilterConfig[]>(
    () => [
      { key: "id", minWidth: "12rem", placeholder: "简历ID，如sdvs****xscs", type: "search" },
      { key: "candidateName", minWidth: "9rem", placeholder: "候选人姓名", type: "search" },
      { key: "candidateEmail", minWidth: "10rem", placeholder: "邮箱", type: "search" },
      { key: "candidatePhone", minWidth: "9rem", placeholder: "电话", type: "search" },
      {
        key: "stage",
        options: Object.entries(pipelineStageMeta).map(([value, meta]) => ({
          label: meta.label,
          value,
        })),
        placeholder: "招聘阶段",
        type: "select",
      },
      {
        key: "creatorIds",
        options: (membersQuery.data?.records ?? []).map((member) => ({
          avatarUrl: member.image,
          label: member.name,
          searchValue: `${member.name} ${member.email}`,
          value: member.id,
        })),
        placeholder: "按创建人筛选",
        type: "multi-select",
      },
      {
        key: "hiringUnitId",
        options: (hiringUnitsQuery.data ?? []).map((unit) => ({
          label: unit.name,
          value: unit.id,
        })),
        placeholder: "用人组织",
        type: "select",
      },
      {
        key: "jdIds",
        options: (jobsQuery.data ?? []).map(
          (job: { departmentName: string | null; id: string; name: string }) => ({
            label: job.departmentName ? `${job.departmentName} / ${job.name}` : job.name,
            value: job.id,
          }),
        ),
        placeholder: "关联岗位",
        type: "select",
      },
      {
        key: "skills",
        options: (skillsQuery.data ?? []).map((item) => ({
          description: `${item.count} 位候选人`,
          label: item.skill,
          value: item.skill,
        })),
        placeholder: "按技能筛选（需同时具备）",
        type: "multi-select",
      },
    ],
    [hiringUnitsQuery.data, jobsQuery.data, membersQuery.data?.records, skillsQuery.data],
  );
  const [sort] = grid.sorting;
  const getAllRows = async () => {
    const rows: ResumeLibraryListRecord[] = [];
    let page = 1;
    let { total } = grid.bind;
    while (rows.length < Math.min(total, DATA_EXPORT_LIMIT)) {
      const result = await fetchRows({
        filters: grid.filters,
        page,
        pageSize: 100,
        sortBy: sort?.id,
        sortOrder: sort?.desc ? "desc" : "asc",
      });
      rows.push(...result.records);
      ({ total } = result);
      if (page >= result.totalPages) {
        break;
      }
      page += 1;
    }
    return rows;
  };
  const columns = useMemo(
    () => [
      textColumn<ResumeLibraryListRecord>({
        key: "candidateName",
        primary: true,
        title: "候选人",
        truncate: "max-w-44",
      }),
      textColumn<ResumeLibraryListRecord>({
        fallback: "—",
        key: "candidateEmail",
        title: "邮箱",
        truncate: "max-w-56",
      }),
      textColumn<ResumeLibraryListRecord>({ fallback: "—", key: "candidatePhone", title: "电话" }),
      badgeColumn<ResumeLibraryListRecord>({
        key: "pipelineStage",
        meta: pipelineStageMeta,
        title: "招聘阶段",
      }),
      textColumn<ResumeLibraryListRecord>({
        fallback: "—",
        key: "jobDescriptionName",
        title: "关联岗位",
        truncate: "max-w-48",
      }),
      textColumn<ResumeLibraryListRecord>({
        fallback: "—",
        key: "hiringUnitName",
        title: "用人组织",
        truncate: true,
      }),
      textColumn<ResumeLibraryListRecord>({ fallback: "—", key: "creatorName", title: "创建人" }),
      dateColumn<ResumeLibraryListRecord>({ key: "createdAt", sortable: true, title: "创建时间" }),
    ],
    [],
  );

  return (
    <>
      <DataGrid
        {...grid.bind}
        columns={columns}
        empty={<ExportEmpty label="候选人" />}
        filters={filters}
        getRowId={(row) => row.id}
        pageSizeOptions={[DATA_EXPORT_PAGE_SIZE]}
        toolbarRight={
          canExportData ? (
            <ExportButton
              disabled={grid.bind.total === 0 || grid.bind.loading || grid.bind.refetching}
              onClick={() => setDialogOpen(true)}
            />
          ) : undefined
        }
      />
      <DataExportDialog
        columns={candidateExportColumns}
        currentRows={grid.bind.data}
        defaultColumnIds={candidateDefaultColumnIds}
        fileName={`候选人管理-${new Date().toISOString().slice(0, 10)}`}
        getAllRows={getAllRows}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        sheetName="候选人管理"
        source="candidates"
        total={grid.bind.total}
      />
    </>
  );
}

function PoolExportTable() {
  const slug = useWorkspaceSlug();
  const canExportData = useHasPermission("dataExport", "export");
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const uploadersQuery = useQuery({
    queryFn: () => fetchResumePoolUploaders(slug),
    queryKey: ["resume-pool-uploaders", slug],
    staleTime: 60_000,
  });
  const uploaderOptions = useMemo(
    () => buildResumePoolUploaderFilterOptions(uploadersQuery.data ?? []),
    [uploadersQuery.data],
  );
  const uploaderAvailability = getResumePoolUploaderFilterAvailability({
    isFetching: uploadersQuery.isFetching,
    isSuccess: uploadersQuery.isSuccess,
    uploaders: uploadersQuery.data ?? [],
  });
  const fetchFilteredRows = useMemo(
    () =>
      async (
        filters: PoolExportFilters,
        search: string,
        sortBy?: string,
        sortOrder?: "asc" | "desc",
        pageSize = DATA_EXPORT_LIMIT,
      ) => {
        const scope: ResumePoolScope = filters.scope === "private" ? "private" : "public";
        const result = await fetchResumePoolItems(slug, scope, {
          id: filters.id || undefined,
          importStatus:
            filters.importStatus === "imported" || filters.importStatus === "not_imported"
              ? filters.importStatus
              : undefined,
          pageSize,
          parseStatus: filters.parseStatus
            ? (filters.parseStatus as "failed" | "processing" | "queued" | "ready" | "unparsed")
            : undefined,
          search: search || undefined,
          sortBy: sortBy as "candidateName" | "createdAt" | "updatedAt" | undefined,
          sortOrder,
          sourceType:
            filters.sourceType === "referral" || filters.sourceType === "non_referral"
              ? filters.sourceType
              : undefined,
          uploaderId:
            scope === "private" ? filters.uploaderId || currentUserId || undefined : undefined,
        });
        return result;
      },
    [currentUserId, slug],
  );
  const grid = useDataGridState<ResumePoolListRecord, PoolExportFilters>({
    allowedSortIds: ["createdAt", "candidateName", "updatedAt"],
    defaultPageSize: DATA_EXPORT_PAGE_SIZE,
    defaultSorting: [{ desc: true, id: "createdAt" }],
    initialFilters: POOL_FILTERS,
    maxPageSize: DATA_EXPORT_PAGE_SIZE,
    queryFn: async (params) => {
      const result = await fetchFilteredRows(
        params.filters,
        params.search,
        params.sortBy,
        params.sortOrder,
        params.pageSize,
      );
      return {
        records: result.records,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / params.pageSize)),
      };
    },
    queryKeyBase: ["studio-data-export", "resume-pool", slug],
  });
  const showUploader = grid.filters.scope === "private";
  const filters = useMemo<ToolbarFilterConfig[]>(
    () => [
      {
        clearable: false,
        key: "scope",
        options: [
          { label: "公共简历池", value: "public" },
          { label: "私有简历池", value: "private" },
        ],
        placeholder: "简历池范围",
        required: true,
        type: "select",
      },
      { key: "id", minWidth: "12rem", placeholder: "简历ID，如sdvs****xscs", type: "search" },
      ...(showUploader
        ? [
            {
              disabled: uploaderAvailability.disabled,
              disabledReason: uploaderAvailability.disabledReason,
              key: "uploaderId",
              options: uploaderOptions,
              placeholder: "按上传人筛选",
              type: "select" as const,
            },
          ]
        : []),
      {
        key: "search",
        minWidth: "15rem",
        placeholder: "搜索候选人、邮箱、电话、简历名或目标岗位",
        type: "search",
      },
      {
        clearable: false,
        key: "sourceType",
        options: [
          { label: "全部", value: "all" },
          { label: "内推", value: "referral" },
          { label: "非内推", value: "non_referral" },
        ],
        placeholder: "按类型筛选",
        type: "select",
      },
      {
        key: "parseStatus",
        options: Object.entries(resumeParseStatusMeta).map(([value, meta]) => ({
          label: meta.label,
          value,
        })),
        placeholder: "按解析状态筛选",
        type: "select",
      },
      {
        key: "importStatus",
        options: [
          { label: "已入库", value: "imported" },
          { label: "未入库", value: "not_imported" },
        ],
        placeholder: "按入库状态筛选",
        type: "select",
      },
    ],
    [
      showUploader,
      uploaderAvailability.disabled,
      uploaderAvailability.disabledReason,
      uploaderOptions,
    ],
  );
  const [sort] = grid.sorting;
  const getAllRows = async () => {
    const result = await fetchFilteredRows(
      grid.filters,
      grid.search,
      sort?.id,
      sort?.desc ? "desc" : "asc",
    );
    return result.records;
  };
  const columns = useMemo(
    () => [
      textColumn<ResumePoolListRecord>({
        key: "candidateName",
        primary: true,
        title: "候选人",
        truncate: "max-w-44",
      }),
      textColumn<ResumePoolListRecord>({
        fallback: "—",
        key: "candidateEmail",
        title: "邮箱",
        truncate: "max-w-56",
      }),
      textColumn<ResumePoolListRecord>({ fallback: "—", key: "candidatePhone", title: "电话" }),
      textColumn<ResumePoolListRecord>({
        fallback: "—",
        key: "targetRole",
        title: "目标岗位",
        truncate: true,
      }),
      badgeColumn<ResumePoolListRecord>({
        key: "resumeParseStatus",
        meta: resumeParseStatusMeta,
        title: "解析状态",
      }),
      textColumn<ResumePoolListRecord>({
        cell: (row) => row.uploaderName ?? row.uploaderEmail ?? "—",
        key: "uploaderName",
        title: "上传人",
      }),
      dateColumn<ResumePoolListRecord>({ key: "createdAt", sortable: true, title: "创建时间" }),
    ],
    [],
  );

  return (
    <>
      <DataGrid
        {...grid.bind}
        columns={columns}
        empty={<ExportEmpty label="简历" />}
        filters={filters}
        getRowId={(row) => row.id}
        pageSizeOptions={[DATA_EXPORT_PAGE_SIZE]}
        toolbarRight={
          canExportData ? (
            <ExportButton
              disabled={grid.bind.total === 0 || grid.bind.loading || grid.bind.refetching}
              onClick={() => setDialogOpen(true)}
            />
          ) : undefined
        }
      />
      <DataExportDialog
        columns={poolExportColumns}
        currentRows={grid.bind.data}
        defaultColumnIds={poolDefaultColumnIds}
        fileName={`简历池-${new Date().toISOString().slice(0, 10)}`}
        getAllRows={getAllRows}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        sheetName="简历池"
        source="resumePool"
        total={grid.bind.total}
      />
    </>
  );
}

export function DataExportPage() {
  const [source, setSource] = useState<DataExportSource>("candidates");
  const canReadResumePool = useHasPermission("resumePool", "read");
  return (
    <main className="mx-auto flex w-full max-w-[96em] flex-col gap-6">
      <PageHeader
        description="按候选人管理或简历池的筛选条件查看数据，并导出为 XLSX 文件。"
        title="导出数据"
      />
      <Tabs onValueChange={(value) => setSource(value as DataExportSource)} value={source}>
        <TabsList aria-label="导出数据来源" variant="underline">
          <TabsTab value="candidates">候选人管理</TabsTab>
          <TabsTab disabled={!canReadResumePool} value="resumePool">
            简历池
          </TabsTab>
        </TabsList>
      </Tabs>
      {source === "candidates" || !canReadResumePool ? (
        <CandidateExportTable />
      ) : (
        <PoolExportTable />
      )}
    </main>
  );
}
