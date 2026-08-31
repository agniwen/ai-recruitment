"use client";

import { useMemo } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type {
  OdcAnalysisData,
  OdcAnalysisJobOption,
  OdcAnalysisMetric,
  OdcAnalysisResumeActivity,
  OdcAnalysisSearch,
} from "@arc/shared/odc-analysis";
import { toBeijingDayKey } from "@arc/shared/beijing-calendar";
import { DatePicker } from "@/components/date-time-picker";
import { PageHeader } from "@/components/features/studio/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ODC_ANALYSIS_TONE_STYLES, ODC_ANALYSIS_UNIT_LABEL } from "./odc-analysis-visuals";
import type { OdcAnalysisSectionTone } from "./odc-analysis-visuals";

interface MetricDefinition {
  activity: OdcAnalysisResumeActivity;
  description: string;
  key: keyof OdcAnalysisData["overall"] | keyof OdcAnalysisData["activity"];
  label: string;
}

interface ActivitySectionData {
  activity: OdcAnalysisData["activity"];
  activityInterviewStates: OdcAnalysisData["activityInterviewStates"];
  upcoming: OdcAnalysisData["upcoming"];
}

interface SectionQuery<T> {
  data: T | undefined;
  error: boolean;
  loading: boolean;
  retry: () => void;
}

const OVERALL_METRICS: MetricDefinition[] = [
  {
    activity: "associated_resume",
    description: "筛选范围内已关联岗位且解析完成的候选人数",
    key: "associatedResumes",
    label: "已关联简历",
  },
  {
    activity: "pending_evaluation",
    description: "筛选范围内关联且当前仍在简历筛选阶段、尚无评估结果的候选人数",
    key: "currentPendingEvaluation",
    label: "当前待评估",
  },
  {
    activity: "ai_interview",
    description: "按候选人去重，多轮 AI 面试只计一人",
    key: "aiInterviews",
    label: "AI 面试",
  },
  {
    activity: "human_interview",
    description: "未取消的真人面试轮次数",
    key: "humanInterviewRounds",
    label: "面试环节数",
  },
  {
    activity: "offer",
    description: "按同一候选人同一岗位首次成功发送统计",
    key: "offers",
    label: "Offer",
  },
  {
    activity: "expected_arrival",
    description: "已接受 Offer 中预计到岗日期落入范围的候选人数",
    key: "expectedArrivals",
    label: "即将到岗",
  },
  {
    activity: "onboarded",
    description: "实际到岗日期落入范围且已确认到岗的候选人数",
    key: "onboarded",
    label: "实际到岗",
  },
  {
    activity: "closed",
    description: "按结案时间统计，保留淘汰和撤回拆分",
    key: "rejectedOrWithdrawn",
    label: "淘汰 / 撤回",
  },
];

const ACTIVITY_METRICS: MetricDefinition[] = [
  {
    activity: "associated_resume",
    description: "当日新关联岗位且解析完成的候选人数",
    key: "associatedResumes",
    label: "关联简历",
  },
  {
    activity: "pending_evaluation",
    description: "当日关联且当前仍未完成简历评估的候选人数",
    key: "currentPendingEvaluation",
    label: "待评估",
  },
  {
    activity: "ai_interview",
    description: "当日计划开展 AI 面试的去重候选人数",
    key: "aiInterviews",
    label: "AI 面试",
  },
  {
    activity: "human_interview",
    description: "当日计划开展且未取消的真人面试轮次",
    key: "humanInterviewRounds",
    label: "面试环节",
  },
  {
    activity: "offer",
    description: "当日首次成功发送的逻辑 Offer 数",
    key: "newOffers",
    label: "新增 Offer",
  },
  {
    activity: "expected_arrival",
    description: "预计到岗日期为当日且 Offer 已接受的候选人数",
    key: "expectedArrivals",
    label: "将到岗",
  },
  {
    activity: "onboarded",
    description: "实际到岗日期为当日的候选人数",
    key: "onboarded",
    label: "实际到岗",
  },
  {
    activity: "closed",
    description: "当日结案为淘汰或撤回的候选人数",
    key: "rejectedOrWithdrawn",
    label: "淘汰 / 撤回",
  },
];

function formatDay(day: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));
}

function breakdownText(metric: OdcAnalysisMetric): string | null {
  if (!metric.breakdown) {
    return null;
  }
  const labels: Record<string, string> = { rejected: "淘汰", withdrawn: "撤回" };
  return Object.entries(metric.breakdown)
    .map(([key, value]) => `${labels[key] ?? key} ${value}`)
    .join(" · ");
}

function MetricCardContent({
  description,
  label,
  metric,
  tone,
}: {
  description: string;
  label: string;
  metric: OdcAnalysisMetric;
  tone: OdcAnalysisSectionTone;
}) {
  const detail = breakdownText(metric);
  return (
    <Card
      className={cn("h-full", ODC_ANALYSIS_TONE_STYLES[tone].card)}
      title={`${description}${detail ? `；${detail}` : ""}`}
    >
      <CardHeader className="pb-3">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {metric.value.toLocaleString("zh-CN")}
          <span className="ms-1 text-muted-foreground text-sm font-normal">
            {ODC_ANALYSIS_UNIT_LABEL[metric.unit]}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-12 flex-col gap-1 pt-0 text-muted-foreground text-xs">
        <span>{description}</span>
        {detail ? <span className="text-foreground">{detail}</span> : null}
      </CardContent>
    </Card>
  );
}

function ResumeMetricCard({
  activityFrom,
  activityTo,
  definition,
  jdIds,
  metric,
  slug,
  tone,
}: {
  activityFrom?: string;
  activityTo?: string;
  definition: MetricDefinition;
  jdIds?: string;
  metric: OdcAnalysisMetric;
  slug?: string;
  tone: OdcAnalysisSectionTone;
}) {
  const content = (
    <MetricCardContent
      description={definition.description}
      label={definition.label}
      metric={metric}
      tone={tone}
    />
  );
  return slug ? (
    <Link
      className="rounded-xl outline-none ring-offset-background transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      params={{ slug }}
      search={{ activity: definition.activity, activityFrom, activityTo, jdIds }}
      to="/w/$slug/studio/resumes"
    >
      {content}
    </Link>
  ) : (
    content
  );
}

function DemandSummary({
  canDrillDown,
  data,
  search,
  slug,
}: {
  canDrillDown: boolean;
  data: OdcAnalysisData["demand"];
  search: OdcAnalysisSearch;
  slug: string;
}) {
  const items = [
    ["对接岗位", data.connectedJobs],
    ["总 HC", data.totalHeadcount],
    ["已到岗", data.onboarded],
    ["空缺", data.vacancies],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {items.map(([label, metric]) => {
        const content = (
          <MetricCardContent
            description="查看符合当前需求日期筛选的在招岗位"
            label={label}
            metric={metric}
            tone="blue"
          />
        );
        return canDrillDown ? (
          <Link
            className="rounded-xl outline-none ring-offset-background transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            key={label}
            params={{ slug }}
            search={{
              dateField: search.demandDateField ?? "requestedDate",
              dateFrom: search.demandFrom,
              dateTo: search.demandTo,
            }}
            to="/w/$slug/studio/job-descriptions"
          >
            {content}
          </Link>
        ) : (
          <div key={label}>{content}</div>
        );
      })}
    </div>
  );
}

function MetricsGrid({
  activityFrom,
  activityTo,
  definitions,
  jdIds,
  metrics,
  slug,
  tone,
}: {
  activityFrom?: string;
  activityTo?: string;
  definitions: MetricDefinition[];
  jdIds?: string;
  metrics: OdcAnalysisData["overall"] | OdcAnalysisData["activity"];
  slug?: string;
  tone: OdcAnalysisSectionTone;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {definitions.map((definition) => (
        <ResumeMetricCard
          activityFrom={activityFrom}
          activityTo={activityTo}
          definition={definition}
          jdIds={jdIds}
          key={definition.key}
          metric={metrics[definition.key as keyof typeof metrics]}
          slug={slug}
          tone={tone}
        />
      ))}
    </div>
  );
}

function JobFilter({
  id,
  jobs,
  onChange,
  value,
}: {
  id: string;
  jobs: OdcAnalysisJobOption[];
  onChange: (value: string[]) => void;
  value: string[];
}) {
  const options = useMemo(
    () =>
      jobs.map((job) => ({
        description: [job.code, job.recruitmentStatus].filter(Boolean).join(" · ") || undefined,
        label: job.name,
        value: job.id,
      })),
    [jobs],
  );
  return (
    <SearchableMultiSelect
      id={id}
      onChange={onChange}
      options={options}
      placeholder="全部岗位"
      searchPlaceholder="搜索岗位"
      selectedDisplay="count"
      selectedFormat={(count) => `已选 ${count} 个岗位`}
      value={value}
    />
  );
}

function DashboardSection({
  children,
  description,
  title,
  tone,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
  tone: OdcAnalysisSectionTone;
}) {
  const styles = ODC_ANALYSIS_TONE_STYLES[tone];
  return (
    <section
      className={cn(
        "relative flex flex-col gap-5 overflow-hidden rounded-2xl border p-5 md:p-6",
        styles.panel,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

function UpcomingSummary({ data }: { data: ActivitySectionData }) {
  const styles = ODC_ANALYSIS_TONE_STYLES.green;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className={styles.card}>
        <CardHeader>
          <CardTitle>所选日期后 3 天 AI 面试</CardTitle>
          <CardDescription>按候选人去重，不包含已取消安排</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {data.upcoming.aiInterviews.map((item) => (
            <div
              className={cn("flex flex-col gap-1 rounded-xl border p-3", styles.subtle)}
              key={item.day}
            >
              <span className="text-muted-foreground text-xs">{formatDay(item.day)}</span>
              <span className="text-xl tabular-nums">{item.value} 人</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className={styles.card}>
        <CardHeader>
          <CardTitle>当日面试状态与后续到岗计划</CardTitle>
          <CardDescription>面试状态按真人面试轮次，预计到岗只统计已接受 Offer</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              ["已完成", data.activityInterviewStates.completed],
              ["进行中", data.activityInterviewStates.inProgress],
              ["即将开始", data.activityInterviewStates.upcoming],
            ].map(([label, value]) => (
              <div
                className={cn("flex flex-col gap-1 rounded-xl border p-3", styles.subtle)}
                key={label}
              >
                <span className="text-muted-foreground text-xs">{label}</span>
                <span className="text-xl tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {data.upcoming.arrivals.map((item) => (
              <div
                className={cn("flex flex-col gap-1 rounded-xl border p-3", styles.subtle)}
                key={item.day}
              >
                <span className="text-muted-foreground text-xs">{formatDay(item.day)} 到岗</span>
                <span className="text-xl tabular-nums">{item.value} 人</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton className="h-40 rounded-2xl" key={index} />
      ))}
    </div>
  );
}

export function DemandResultsSkeleton() {
  return <MetricCardsSkeleton count={4} />;
}

export function MetricsResultsSkeleton() {
  return <MetricCardsSkeleton count={8} />;
}

export function ActivityResultsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <MetricCardsSkeleton count={8} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-52 rounded-2xl" />
        <Skeleton className="h-52 rounded-2xl" />
      </div>
    </div>
  );
}

function OdcAnalysisInitialResultsSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      {[4, 8, 8].map((count, sectionIndex) => (
        <section className="flex flex-col gap-4" key={sectionIndex}>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-20 w-full rounded-xl" />
          <MetricCardsSkeleton count={count} />
        </section>
      ))}
    </div>
  );
}

function OdcAnalysisSectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>数据加载失败</CardTitle>
        <CardDescription>筛选条件已保留，可以重试本次查询。</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onRetry} type="button">
          重新加载
        </Button>
      </CardContent>
    </Card>
  );
}

function SectionResults<T>({
  children,
  query,
  skeleton,
}: {
  children: (data: T) => React.ReactNode;
  query: SectionQuery<T>;
  skeleton: React.ReactNode;
}) {
  return (
    <div aria-busy={query.loading} aria-live="polite">
      {query.loading ? skeleton : null}
      {!query.loading && query.error ? <OdcAnalysisSectionError onRetry={query.retry} /> : null}
      {!query.loading && !query.error && query.data ? children(query.data) : null}
    </div>
  );
}

export function OdcAnalysisPage({
  activityQuery,
  canViewJobDescriptions,
  canViewResumes,
  demandQuery,
  jobs,
  overallQuery,
  search,
}: {
  activityQuery: SectionQuery<ActivitySectionData>;
  canViewJobDescriptions: boolean;
  canViewResumes: boolean;
  demandQuery: SectionQuery<OdcAnalysisData["demand"]>;
  jobs: OdcAnalysisJobOption[];
  overallQuery: SectionQuery<OdcAnalysisData["overall"]>;
  search: OdcAnalysisSearch;
}) {
  const navigate = useNavigate({ from: "/w/$slug/studio/odc-analysis" });
  const { slug } = useParams({ from: "/w/$slug/studio/odc-analysis" });
  const progressJobs = search.progressJdIds?.split(",").filter(Boolean) ?? [];
  const activityJobs = search.activityJdIds?.split(",").filter(Boolean) ?? [];
  const activityDate = search.activityDate ?? toBeijingDayKey(new Date());
  const updateSearch = (updates: Partial<OdcAnalysisSearch>) => {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (previous) => ({ ...previous, ...updates }),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-8">
      <PageHeader
        title="ODC 分析"
        description="分别查看岗位需求、候选人招聘进度与指定日期动态。招聘指标仅统计在「角色与权限」中标记为 ODC 的自定义角色。"
      />
      <div className="flex flex-col gap-10">
        <DashboardSection
          description="按在招岗位的提需求日期或期望到岗日期筛选；开始和结束日期均可留空。"
          title="岗位需求概览"
          tone="blue"
        >
          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-[14rem_12rem_12rem_auto] xl:items-end">
            <Field>
              <FieldLabel htmlFor="odc-demand-date-field">日期字段</FieldLabel>
              <Select
                onValueChange={(value) =>
                  updateSearch({
                    demandDateField:
                      value === "expectedOnboardDate" ? "expectedOnboardDate" : undefined,
                  })
                }
                value={search.demandDateField ?? "requestedDate"}
              >
                <SelectTrigger className="w-full" id="odc-demand-date-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="requestedDate">提需求日期</SelectItem>
                    <SelectItem value="expectedOnboardDate">期望到岗日期</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-demand-from">开始日期</FieldLabel>
              <DatePicker
                id="odc-demand-from"
                max={search.demandTo}
                onValueChange={(value) => updateSearch({ demandFrom: value || undefined })}
                placeholder="不限开始日期"
                value={search.demandFrom ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-demand-to">结束日期</FieldLabel>
              <DatePicker
                id="odc-demand-to"
                min={search.demandFrom}
                onValueChange={(value) => updateSearch({ demandTo: value || undefined })}
                placeholder="不限结束日期"
                value={search.demandTo ?? ""}
              />
            </Field>
            <Button
              onClick={() =>
                updateSearch({
                  demandDateField: undefined,
                  demandFrom: undefined,
                  demandTo: undefined,
                })
              }
              type="button"
              variant="outline"
            >
              重置
            </Button>
          </FieldGroup>
          <SectionResults query={demandQuery} skeleton={<DemandResultsSkeleton />}>
            {(data) => (
              <DemandSummary
                canDrillDown={canViewJobDescriptions}
                data={data}
                search={search}
                slug={slug}
              />
            )}
          </SectionResults>
        </DashboardSection>

        <DashboardSection
          description="统计候选人管理中的记录；日期范围和岗位均不选择时不限制。不同指标按各自业务时间统计。"
          title="招聘整体进度"
          tone="amber"
        >
          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[12rem_12rem_minmax(18rem,1fr)_auto] xl:items-end">
            <Field>
              <FieldLabel htmlFor="odc-progress-from">开始日期</FieldLabel>
              <DatePicker
                id="odc-progress-from"
                max={search.progressTo}
                onValueChange={(value) => updateSearch({ progressFrom: value || undefined })}
                placeholder="不限开始日期"
                value={search.progressFrom ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-progress-to">结束日期</FieldLabel>
              <DatePicker
                id="odc-progress-to"
                min={search.progressFrom}
                onValueChange={(value) => updateSearch({ progressTo: value || undefined })}
                placeholder="不限结束日期"
                value={search.progressTo ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-progress-jobs">岗位</FieldLabel>
              <JobFilter
                id="odc-progress-jobs"
                jobs={jobs}
                onChange={(value) =>
                  updateSearch({
                    progressJdIds: value.length > 0 ? value.toSorted().join(",") : undefined,
                  })
                }
                value={progressJobs}
              />
            </Field>
            <Button
              onClick={() =>
                updateSearch({
                  progressFrom: undefined,
                  progressJdIds: undefined,
                  progressTo: undefined,
                })
              }
              type="button"
              variant="outline"
            >
              重置
            </Button>
          </FieldGroup>
          <SectionResults query={overallQuery} skeleton={<MetricsResultsSkeleton />}>
            {(data) => (
              <MetricsGrid
                activityFrom={search.progressFrom}
                activityTo={search.progressTo}
                definitions={OVERALL_METRICS}
                jdIds={search.progressJdIds}
                metrics={data}
                slug={canViewResumes ? slug : undefined}
                tone="amber"
              />
            )}
          </SectionResults>
        </DashboardSection>

        <DashboardSection
          description="按北京时间自然日统计；默认今天，岗位默认全部。下方未来安排以所选日期为起点。"
          title="当日动态"
          tone="green"
        >
          <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[12rem_minmax(18rem,1fr)_auto] xl:items-end">
            <Field>
              <FieldLabel htmlFor="odc-activity-date">日期</FieldLabel>
              <DatePicker
                id="odc-activity-date"
                onValueChange={(value) => updateSearch({ activityDate: value || undefined })}
                value={activityDate}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="odc-activity-jobs">岗位</FieldLabel>
              <JobFilter
                id="odc-activity-jobs"
                jobs={jobs}
                onChange={(value) =>
                  updateSearch({
                    activityJdIds: value.length > 0 ? value.toSorted().join(",") : undefined,
                  })
                }
                value={activityJobs}
              />
            </Field>
            <Button
              onClick={() => updateSearch({ activityDate: undefined, activityJdIds: undefined })}
              type="button"
              variant="outline"
            >
              回到今天
            </Button>
          </FieldGroup>
          <SectionResults query={activityQuery} skeleton={<ActivityResultsSkeleton />}>
            {(data) => (
              <div className="flex flex-col gap-4">
                <MetricsGrid
                  activityFrom={activityDate}
                  activityTo={activityDate}
                  definitions={ACTIVITY_METRICS}
                  jdIds={search.activityJdIds}
                  metrics={data.activity}
                  slug={canViewResumes ? slug : undefined}
                  tone="green"
                />
                <UpcomingSummary data={data} />
              </div>
            )}
          </SectionResults>
        </DashboardSection>
      </div>
    </div>
  );
}

export function OdcAnalysisPageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <OdcAnalysisInitialResultsSkeleton />
    </div>
  );
}

export function OdcAnalysisPageError({ reset }: { reset: () => void }) {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>ODC 分析加载失败</CardTitle>
        <CardDescription>筛选条件已保留，可以重试本次查询。</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={reset} type="button">
          重新加载
        </Button>
      </CardContent>
    </Card>
  );
}
