"use client";

import { IconFileAlert, IconFileCheck } from "@tabler/icons-react";
import { useCallback, useMemo } from "react";
import {
  customColumn,
  DataGrid,
  dateColumn,
  textColumn,
  useDataGridState,
} from "@/components/data-grid";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";

type HistoricalResumeImportView = "failed" | "records";

interface HistoricalResumeImportFilters extends Record<string, string> {
  view: HistoricalResumeImportView;
}

interface HistoricalResumeImportRecord {
  currentStep: string | null;
  failedStep: string | null;
  failureCount: number;
  failureReason: string | null;
  filename: string;
  finishedAt: string | null;
  id: string;
  organizationName: string;
  organizationSlug: string;
  poolItemId: string | null;
  sourceFolder: string | null;
  startedAt: string | null;
  status: string;
  uploaderEmail: string;
  uploaderName: string;
}

interface HistoricalResumeImportResult {
  page: number;
  pageSize: number;
  records: HistoricalResumeImportRecord[];
  total: number;
  totalPages: number;
}

const INITIAL_FILTERS: HistoricalResumeImportFilters = { view: "records" };

export function HistoricalResumeImportsGrid() {
  const fetchRecords = useCallback(
    (params: {
      filters: HistoricalResumeImportFilters;
      page: number;
      pageSize: number;
      search: string;
    }): Promise<HistoricalResumeImportResult> =>
      rpcFetch<HistoricalResumeImportResult>(
        rpc.api.platform["historical-resume-imports"].$get({
          query: {
            page: String(params.page),
            pageSize: String(params.pageSize),
            ...(params.search ? { search: params.search } : {}),
            view: params.filters.view,
          },
        }),
        "加载历史简历记录失败",
      ),
    [],
  );

  const grid = useDataGridState<HistoricalResumeImportRecord, HistoricalResumeImportFilters>({
    defaultPageSize: 10,
    initialFilters: INITIAL_FILTERS,
    queryFn: fetchRecords,
    queryKeyBase: ["platform-historical-resume-imports"],
    refetchInterval: 5000,
  });

  const recordColumns = useMemo(
    () => [
      customColumn<HistoricalResumeImportRecord>({
        cell: (record) => (
          <div className="flex flex-col gap-1">
            <Badge variant={record.status === "processing" ? "info" : "success"}>
              {record.status === "processing" ? "解析中" : "已成功"}
            </Badge>
            {record.currentStep ? (
              <span className="text-muted-foreground text-xs">{record.currentStep}</span>
            ) : null}
          </div>
        ),
        key: "status",
        title: "状态",
      }),
      textColumn<HistoricalResumeImportRecord>({ key: "filename", primary: true, title: "文件名" }),
      textColumn<HistoricalResumeImportRecord>({
        fallback: "—",
        key: "sourceFolder",
        muted: true,
        title: "来源文件夹",
      }),
      customColumn<HistoricalResumeImportRecord>({
        cell: (record) => (
          <div className="flex flex-col gap-1">
            <span>{record.organizationName}</span>
            <span className="text-muted-foreground text-xs">{record.organizationSlug}</span>
          </div>
        ),
        key: "organization",
        title: "工作区",
      }),
      customColumn<HistoricalResumeImportRecord>({
        cell: (record) => (
          <div className="flex flex-col gap-1">
            <span>{record.uploaderName}</span>
            <span className="text-muted-foreground text-xs">{record.uploaderEmail}</span>
          </div>
        ),
        key: "uploader",
        title: "上传人",
      }),
      dateColumn<HistoricalResumeImportRecord>({
        emptyText: "未开始",
        key: "startedAt",
        title: "开始时间",
      }),
      dateColumn<HistoricalResumeImportRecord>({
        emptyText: "处理中",
        key: "finishedAt",
        title: "结束时间",
      }),
    ],
    [],
  );

  const failedColumns = useMemo(
    () => [
      customColumn<HistoricalResumeImportRecord>({
        cell: () => <Badge variant="destructive">最终失败</Badge>,
        key: "status",
        title: "状态",
      }),
      textColumn<HistoricalResumeImportRecord>({ key: "filename", primary: true, title: "文件名" }),
      textColumn<HistoricalResumeImportRecord>({
        fallback: "—",
        key: "sourceFolder",
        muted: true,
        title: "来源文件夹",
      }),
      customColumn<HistoricalResumeImportRecord>({
        cell: (record) => <Badge variant="outline">{record.failureCount} 次</Badge>,
        key: "failureCount",
        title: "失败次数",
      }),
      textColumn<HistoricalResumeImportRecord>({
        fallback: "—",
        key: "failedStep",
        title: "失败步骤",
      }),
      customColumn<HistoricalResumeImportRecord>({
        cell: (record) => (
          <p className="max-w-96 truncate" title={record.failureReason ?? ""}>
            {record.failureReason ?? "—"}
          </p>
        ),
        key: "failureReason",
        title: "失败原因",
      }),
      customColumn<HistoricalResumeImportRecord>({
        cell: (record) => (
          <div className="flex flex-col gap-1">
            <span>{record.organizationName}</span>
            <span className="text-muted-foreground text-xs">{record.organizationSlug}</span>
          </div>
        ),
        key: "organization",
        title: "工作区",
      }),
      dateColumn<HistoricalResumeImportRecord>({
        emptyText: "—",
        key: "finishedAt",
        title: "处理时间",
      }),
    ],
    [],
  );

  const isFailedView = grid.filters.view === "failed";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl">历史简历解析记录</h1>
        <p className="text-muted-foreground text-sm">
          查看 MinIO 历史简历的解析进度、成功入池记录和最终失败原因。
        </p>
      </div>
      <Tabs
        onValueChange={(value) => grid.setFilter("view", value as HistoricalResumeImportView)}
        value={grid.filters.view}
      >
        <TabsList>
          <TabsTrigger value="records">解析中 / 已成功</TabsTrigger>
          <TabsTrigger value="failed">最终失败</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataGrid<HistoricalResumeImportRecord>
        {...grid.bind}
        columns={isFailedView ? failedColumns : recordColumns}
        empty={
          <Empty className="border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {isFailedView ? <IconFileAlert /> : <IconFileCheck />}
              </EmptyMedia>
              <EmptyTitle>{isFailedView ? "暂无最终失败记录" : "暂无解析记录"}</EmptyTitle>
              <EmptyDescription>
                {isFailedView
                  ? "连续三次解析失败的历史简历会显示在这里。"
                  : "解析中的记录和成功入池记录会显示在这里。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        filters={[
          {
            key: "search",
            minWidth: "22rem",
            placeholder: "搜索文件、目录、工作区或上传人",
            type: "search",
          },
        ]}
        getRowId={(record) => record.id}
      />
    </div>
  );
}
