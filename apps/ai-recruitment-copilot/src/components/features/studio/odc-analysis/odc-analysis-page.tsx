"use client";

import { useMemo } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type {
  OdcAnalysisData,
  OdcAnalysisJobOption,
  OdcAnalysisMetric,
  OdcAnalysisSearch,
} from "@arc/shared/odc-analysis";
import { PageHeader } from "@/components/features/studio/page-header";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const UNIT_LABEL: Record<OdcAnalysisMetric["unit"], string> = {
  candidate: "人",
  headcount: "HC",
  job: "个岗位",
  offer: "个 Offer",
  round: "个环节",
};

interface MetricDefinition {
  description: string;
  key: keyof OdcAnalysisData["overall"] | keyof OdcAnalysisData["today"];
  label: string;
  resumeStage?: string;
}

const OVERALL_METRICS: MetricDefinition[] = [
  {
    description: "筛选范围内已关联岗位的候选人数",
    key: "associatedResumes",
    label: "已关联简历",
    resumeStage: "",
  },
  {
    description: "仍在简历筛选阶段且尚无评估结果的候选人数",
    key: "currentPendingEvaluation",
    label: "当前待评估",
    resumeStage: "screening",
  },
  { description: "按候选人去重，多轮 AI 面试只计一人", key: "aiInterviews", label: "AI 面试" },
  { description: "未取消的真人面试轮次数", key: "humanInterviewRounds", label: "面试环节数" },
  { description: "按同一候选人同一岗位首次成功发送统计", key: "offers", label: "Offer" },
  {
    description: "已接受 Offer 中预计到岗日期落入范围的候选人数",
    key: "expectedArrivals",
    label: "即将到岗",
  },
  { description: "已明确确认实际到岗的候选人数", key: "onboarded", label: "实际到岗" },
  {
    description: "按结案时间统计，保留淘汰和撤回拆分",
    key: "rejectedOrWithdrawn",
    label: "淘汰 / 撤回",
  },
];

const TODAY_METRICS: MetricDefinition[] = [
  { description: "今天新关联岗位的候选人数", key: "associatedResumes", label: "今日关联简历" },
  {
    description: "今天关联且当前仍未完成简历评估的候选人数",
    key: "currentPendingEvaluation",
    label: "今日待评估",
  },
  { description: "今天计划开展 AI 面试的去重候选人数", key: "aiInterviews", label: "今日 AI 面试" },
  {
    description: "今天计划开展且未取消的真人面试轮次",
    key: "humanInterviewRounds",
    label: "今日面试环节",
  },
  { description: "今天首次成功发送的逻辑 Offer 数", key: "newOffers", label: "今日新增 Offer" },
  {
    description: "预计到岗日期为今天且 Offer 已接受的候选人数",
    key: "expectedArrivals",
    label: "今日将到岗",
  },
  { description: "实际到岗日期为今天的候选人数", key: "onboarded", label: "今日实际到岗" },
  {
    description: "今天结案为淘汰或撤回的候选人数",
    key: "rejectedOrWithdrawn",
    label: "今日淘汰 / 撤回",
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

function MetricCard({
  definition,
  drilldown,
  metric,
}: {
  definition: MetricDefinition;
  drilldown?: { jdIds?: string; slug: string; stage: string };
  metric: OdcAnalysisMetric;
}) {
  const detail = breakdownText(metric);
  const content = (
    <Card title={`${definition.description}${detail ? `；${detail}` : ""}`}>
      <CardHeader className="pb-3">
        <CardDescription>{definition.label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {metric.value.toLocaleString("zh-CN")}
          <span className="ml-1 text-muted-foreground text-sm font-normal">
            {UNIT_LABEL[metric.unit]}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-12 flex-col gap-1 pt-0 text-muted-foreground text-xs">
        <span>{definition.description}</span>
        {detail ? <span className="text-foreground">{detail}</span> : null}
      </CardContent>
    </Card>
  );
  return drilldown ? (
    <Link
      className="rounded-xl outline-none ring-offset-background transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      params={{ slug: drilldown.slug }}
      search={{ jdIds: drilldown.jdIds, stage: drilldown.stage }}
      to="/w/$slug/studio/resumes"
    >
      {content}
    </Link>
  ) : (
    content
  );
}

function MetricsPanel({
  description,
  definitions,
  drilldown,
  metrics,
  title,
}: {
  description: string;
  definitions: MetricDefinition[];
  drilldown?: { jdIds?: string; slug: string };
  metrics: OdcAnalysisData["overall"] | OdcAnalysisData["today"];
  title: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {definitions.map((definition) => (
          <MetricCard
            definition={definition}
            drilldown={
              drilldown && definition.resumeStage !== undefined
                ? { ...drilldown, stage: definition.resumeStage }
                : undefined
            }
            key={definition.key}
            metric={metrics[definition.key as keyof typeof metrics]}
          />
        ))}
      </div>
    </section>
  );
}

function DemandSummary({ data }: { data: OdcAnalysisData["demand"] }) {
  const items = [
    ["提需日期", data.requestedDate ?? "未设置"],
    ["期望到岗日期", data.expectedOnboardDate ?? "未设置"],
    ["对接岗位", data.connectedJobs.value.toLocaleString("zh-CN")],
    ["总 HC", data.totalHeadcount.value.toLocaleString("zh-CN")],
    ["已到岗", data.onboarded.value.toLocaleString("zh-CN")],
    ["空缺", data.vacancies.value.toLocaleString("zh-CN")],
  ] as const;
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      {items.map(([label, value]) => (
        <Card key={label}>
          <CardHeader className="pb-4">
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}

function UpcomingSummary({ data }: { data: OdcAnalysisData }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>未来 3 天 AI 面试</CardTitle>
          <CardDescription>按候选人去重，不包含已取消安排</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {data.upcoming.aiInterviews.map((item) => (
            <div className="flex flex-col gap-1 rounded-xl bg-muted p-3" key={item.day}>
              <span className="text-muted-foreground text-xs">{formatDay(item.day)}</span>
              <span className="text-xl tabular-nums">{item.value} 人</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>今日面试状态与到岗计划</CardTitle>
          <CardDescription>面试状态按真人面试轮次，预计到岗只统计已接受 Offer</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              ["已完成", data.todayInterviewStates.completed],
              ["进行中", data.todayInterviewStates.inProgress],
              ["即将开始", data.todayInterviewStates.upcoming],
            ].map(([label, value]) => (
              <div className="flex flex-col gap-1 rounded-xl bg-muted p-3" key={label}>
                <span className="text-muted-foreground text-xs">{label}</span>
                <span className="text-xl tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {data.upcoming.arrivals.map((item) => (
              <div
                className="flex flex-col gap-1 rounded-xl border border-input p-3"
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

export function OdcAnalysisPage({
  canViewResumes,
  data,
  jobs,
  search,
}: {
  canViewResumes: boolean;
  data: OdcAnalysisData;
  jobs: OdcAnalysisJobOption[];
  search: OdcAnalysisSearch;
}) {
  const navigate = useNavigate({ from: "/w/$slug/studio/odc-analysis" });
  const { slug } = useParams({ from: "/w/$slug/studio/odc-analysis" });
  const selectedJobs = search.jdIds?.split(",").filter(Boolean) ?? [];
  const jobOptions = useMemo(
    () =>
      jobs.map((job) => ({
        description: [job.code, job.recruitmentStatus].filter(Boolean).join(" · ") || undefined,
        label: job.name,
        value: job.id,
      })),
    [jobs],
  );
  const updateSearch = (next: OdcAnalysisSearch) => {
    void navigate({ replace: true, search: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6">
      <PageHeader
        title="ODC 分析"
        description="查看工作区招聘需求、候选人流转与当日安排。统计覆盖所有参与招聘的角色。"
      />
      <Card>
        <CardHeader>
          <CardTitle>筛选条件</CardTitle>
          <CardDescription>时间范围作用于每个指标对应的业务发生时间，默认不限制。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-[12rem_12rem_minmax(16rem,1fr)_auto] md:items-end">
          <label className="flex flex-col gap-2 text-sm" htmlFor="odc-analysis-from">
            <span>开始日期</span>
            <Input
              id="odc-analysis-from"
              max={search.to}
              onChange={(event) =>
                updateSearch({ ...search, from: event.target.value || undefined })
              }
              type="date"
              value={search.from ?? ""}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm" htmlFor="odc-analysis-to">
            <span>结束日期</span>
            <Input
              id="odc-analysis-to"
              min={search.from}
              onChange={(event) => updateSearch({ ...search, to: event.target.value || undefined })}
              type="date"
              value={search.to ?? ""}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm" htmlFor="odc-analysis-jobs">
            <span>岗位</span>
            <SearchableMultiSelect
              id="odc-analysis-jobs"
              onChange={(value) =>
                updateSearch({
                  ...search,
                  jdIds: value.length > 0 ? value.toSorted().join(",") : undefined,
                })
              }
              options={jobOptions}
              placeholder="全部岗位"
              searchPlaceholder="搜索岗位"
              selectedDisplay="count"
              selectedFormat={(count) => `已选 ${count} 个岗位`}
              value={selectedJobs}
            />
          </label>
          <Button onClick={() => updateSearch({})} type="button" variant="outline">
            重置
          </Button>
        </CardContent>
      </Card>
      {jobs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>暂无岗位数据</CardTitle>
            <CardDescription>创建或同步在招岗位后，这里会自动汇总招聘进度。</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      <DemandSummary data={data.demand} />
      <MetricsPanel
        definitions={OVERALL_METRICS}
        description="默认展示当前存量；选择时间后，各指标按对应业务时间统计。"
        drilldown={
          canViewResumes && !(search.from || search.to) ? { jdIds: search.jdIds, slug } : undefined
        }
        metrics={data.overall}
        title="招聘整体进度"
      />
      <MetricsPanel
        definitions={TODAY_METRICS}
        description="按北京时间自然日统计，不受上方时间范围影响，岗位筛选继续生效。"
        metrics={data.today}
        title="今日工作台"
      />
      <UpcomingSummary data={data} />
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
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-28 rounded-2xl" key={index} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton className="h-40 rounded-2xl" key={index} />
        ))}
      </div>
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
