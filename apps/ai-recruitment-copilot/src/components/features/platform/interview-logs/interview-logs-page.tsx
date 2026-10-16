import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { IconArrowLeft, IconRefresh, IconSearch } from "@tabler/icons-react";
import { interviewEventLabels } from "@arc/shared/interview-telemetry";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fetchLoggedMeetings, fetchMeetingTimeline } from "./api";
import type { TimelineEvent, MeetingTimeline as TimelineData } from "./api";
import { ParticipantEnvironments } from "./participant-environments";
import { IpReveal } from "../security/ip-reveal";
import { MeetingMediaPanel } from "./meeting-media";
import { MeetingEntryCredentials } from "./meeting-entry-credentials";
import { MediaArchivesPanel } from "./media-archives";
import { MeetingFingerprints } from "./meeting-fingerprints";

const route = getRouteApi("/platform/interview-logs");
const controlClass =
  "h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
const sourceLabels: Record<string, string> = {
  client: "客户端上报",
  livekit: "LiveKit 确认",
  server: "后端确认",
};
const roleLabels: Record<string, string> = {
  candidate: "候选人",
  host: "主持人",
  interviewer: "面试官",
  observer: "旁听",
};
const reasonLabels: Record<string, string> = {
  CLIENT_INITIATED: "客户端发起断开，需结合点击离开、刷新等记录判断",
  DUPLICATE_IDENTITY: "相同身份再次入会，旧连接被顶下线",
  ROOM_DELETED: "房间已被关闭",
  SIGNAL_CLOSE: "信令连接关闭",
  STATE_MISMATCH: "连接状态不一致",
  UNKNOWN_REASON: "退出原因未知",
};
const emptyFilters = {
  attemptId: "",
  fingerprint: "",
  identity: "",
  ip: "",
  source: "",
  type: "",
  visitId: "",
};
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  hour12: false,
  timeStyle: "medium",
  timeZone: "Asia/Shanghai",
});
function time(value: string | null) {
  return value ? timeFormatter.format(new Date(value)) : "—";
}

function Pager({
  page,
  total,
  pending,
  onChange,
}: {
  page: number;
  total: number;
  pending: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
      <span>
        共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 50))} 页
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={page <= 1 || pending}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={page * 50 >= total || pending}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

function EventExplanation({ event }: { event: TimelineEvent }) {
  const reason =
    typeof event.details.reason === "string" ? reasonLabels[event.details.reason] : undefined;
  let network = "网络状态未知";
  if (event.details.online === false) {
    network = "浏览器报告离线";
  } else if (event.details.online === true) {
    network = "浏览器报告在线";
  }
  return (
    <>
      {reason ? <p className="mt-1 text-xs">{reason}</p> : null}
      {event.type === "network_changed" ? <p className="mt-1 text-xs">{network}</p> : null}
      {event.fingerprintId ? (
        <p className="mt-1 break-all font-mono text-xs">{event.fingerprintId}</p>
      ) : null}
    </>
  );
}

function EventRow({ event }: { event: TimelineEvent }) {
  const abnormal =
    event.details.reason === "DUPLICATE_IDENTITY" ||
    ["join_failed", "room_error", "media_device_error", "client_error", "reconnecting"].includes(
      event.type,
    );
  const summary = [event.details.reason, event.details.state, event.details.quality]
    .filter((v) => typeof v === "string")
    .join(" · ");
  return (
    <tr className="border-b align-top last:border-0">
      <td className="whitespace-nowrap py-4 pr-4 text-xs">
        <div>{time(event.receivedAt)}</div>
        <div className="mt-1 text-muted-foreground">发生：{time(event.occurredAt)}</div>
      </td>
      <td className="py-4 pr-4">
        <Badge variant={event.source === "client" ? "outline" : "secondary"}>
          {sourceLabels[event.source] ?? event.source}
        </Badge>
      </td>
      <td className="max-w-48 py-4 pr-4">
        <div className="break-all font-medium">
          {event.participantName || event.participantIdentity || "房间"}
        </div>
        <div className="mt-1 break-all text-xs text-muted-foreground">
          {event.participantIdentity || "房间级事件"}
        </div>
      </td>
      <td className="min-w-52 py-4 pr-4">
        <div
          className={abnormal ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium"}
        >
          {interviewEventLabels[event.type] ?? event.type}
        </div>
        <EventExplanation event={event} />
        <div className="mt-1 break-all text-xs text-muted-foreground">{summary}</div>
        {event.type === "network_sample" ? (
          <div className="mt-2 text-xs text-muted-foreground">
            RTT{" "}
            {event.details.rttMs === undefined
              ? "—"
              : `${Math.round(Number(event.details.rttMs))} ms`}{" "}
            · 丢包累计 {String(event.details.packetsLost ?? "—")} ·{" "}
            {String(event.details.protocol ?? "传输方式未知")}
          </div>
        ) : null}
      </td>
      <td className="min-w-60 py-4 text-xs">
        <IpReveal
          hasIp={event.hasIp}
          reference={{ id: event.id, kind: "telemetry", meetingId: event.meetingId }}
        />
        <details className="mt-2">
          <summary className="cursor-pointer text-muted-foreground">
            查看设备、会话及事件详情
          </summary>
          <dl className="mt-3 space-y-2 break-all">
            {Object.entries({
              "IP 来源": event.ipSource,
              "LiveKit 会话": event.participantSid,
              "LiveKit 房间": event.roomSid,
              "入会 ID": event.attemptId,
              指纹采集器版本: event.fingerprintVersion,
              浏览器: event.userAgent,
              "浏览器存储 ID": event.browserId,
              "浏览器指纹 ID": event.fingerprintId,
              "访问 ID": event.visitId,
              页面事件序号: event.clientSequence?.toString(),
              "页面实例 ID（刷新后变化）": event.tabId,
            }).map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
            <div>
              <dt className="text-muted-foreground">事件数据</dt>
              <dd>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-3">
                  {JSON.stringify(event.details, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </details>
      </td>
    </tr>
  );
}

function webhookStatus(timestamp: string | null | undefined) {
  if (timestamp === undefined) {
    return "";
  }
  return timestamp
    ? `最近 LiveKit 事件：${time(timestamp)}。`
    : "尚未收到这场会议的 LiveKit 事件，请检查 webhook 配置与投递记录。";
}

function MeetingSummary({ summary }: { summary: TimelineData["summary"] | undefined }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[
        ["关键事件", summary?.keyEvents],
        ["全部事件", summary?.events],
        ["页面访问", summary?.visits],
        ["入会尝试", summary?.attempts],
        ["浏览器指纹", summary?.fingerprints],
      ].map(([label, value]) => (
        <div key={label} className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
        </div>
      ))}
    </div>
  );
}

function MeetingTimeline({ meetingId }: { meetingId: string }) {
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"key" | "all">("key");
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const query = useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      fetchMeetingTimeline(meetingId, { ...filters, page: String(page), view }, signal),
    queryKey: ["platform", "interview-logs", meetingId, filters, page, view],
    retry: 1,
    staleTime: 10_000,
  });
  const { data } = query;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{data?.summary.meetingTitle || "会议时间线"}</h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{meetingId}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void query.refetch();
          }}
          disabled={query.isFetching}
        >
          <IconRefresh className="size-4" />
          刷新
        </Button>
      </div>
      <MeetingSummary summary={data?.summary} />
      <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        {webhookStatus(data?.summary.lastWebhookAt)} 指纹、IP
        与客户端事件仅用于关联线索，不能单独证明操作者身份或作弊。
      </p>
      <ParticipantEnvironments
        meetingId={meetingId}
        participants={data?.participants ?? []}
        onFilter={(filter) => {
          setDraft({ ...emptyFilters, ...filter });
          setFilters(filter);
          setPage(1);
        }}
      />
      <MeetingMediaPanel meetingId={meetingId} />
      <MeetingEntryCredentials meetingId={meetingId} />
      <div className="space-y-3 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">事件时间线</h3>
          <fieldset aria-label="事件显示范围" className="flex gap-2">
            {(
              [
                ["key", "关键事件"],
                ["all", "全部事件"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={view === value ? "default" : "outline"}
                aria-pressed={view === value}
                onClick={() => {
                  setView(value);
                  setPage(1);
                  if (value === "key") {
                    setDraft((previous) => ({ ...previous, type: "" }));
                    setFilters(({ type: _type, ...rest }) => rest);
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </fieldset>
        </div>
        <p className="text-xs text-muted-foreground">
          {view === "key"
            ? "显示入会、离开、页面操作、重连及异常。心跳、定时采样、指纹采集、组件卸载和常规连接状态保留在全部事件中。"
            : "显示全部原始记录，包括心跳和网络采样；同一动作可能由客户端、后端和 LiveKit 分别记录。"}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(
            Object.fromEntries(
              Object.entries(draft)
                .map(([key, value]) => [key, value.trim()])
                .filter(([, value]) => value),
            ),
          );
          if (draft.type) {
            setView("all");
          }
          setPage(1);
        }}
      >
        <label className="space-y-1 text-xs">
          <span className="block">事件来源</span>
          <select
            className={controlClass}
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
          >
            <option value="">全部来源</option>
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block">参与者</span>
          <select
            className={controlClass}
            value={draft.identity}
            onChange={(e) => setDraft({ ...draft, identity: e.target.value })}
          >
            <option value="">全部参与者</option>
            {data?.participants.map((p) => (
              <option key={`${p.identity}:${p.name}`} value={p.identity}>
                {p.name} · {roleLabels[p.role ?? ""] ?? "角色未知"}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block">事件</span>
          <select
            className={controlClass}
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            <option value="">全部事件</option>
            {Object.entries(interviewEventLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["visitId", "访问 ID"],
            ["attemptId", "入会 ID"],
            ["ip", "IP"],
            ["fingerprint", "指纹"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} htmlFor={`telemetry-${key}`} className="space-y-1 text-xs">
            <span className="block">{label}</span>
            <Input
              id={`telemetry-${key}`}
              className="w-44"
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <Button type="submit">筛选</Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft(emptyFilters);
            setFilters({});
            setPage(1);
          }}
        >
          重置
        </Button>
      </form>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <table aria-label="事件时间线" className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {["接收时间（北京时间）", "证据来源", "参与者", "事件", "环境与详情"].map((label) => (
                <th key={label} className="px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_td]:pl-4">
            {data?.records.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </tbody>
        </table>
        {query.isPending ? (
          <p className="p-10 text-center text-muted-foreground">正在加载时间线…</p>
        ) : null}
        {!query.isPending && !query.isError && !data?.records.length ? (
          <p className="p-10 text-center text-muted-foreground">
            没有符合条件的事件。采集启用前的历史事件不会自动补入。
          </p>
        ) : null}
      </div>
      <Pager page={page} total={data?.total ?? 0} pending={query.isFetching} onChange={setPage} />
    </div>
  );
}

export function InterviewLogsPage() {
  const { meetingId } = route.useSearch();
  const navigate = route.useNavigate();
  const [search, setSearch] = useState("");
  const [archives, setArchives] = useState(false);
  const [dates, setDates] = useState({ since: "", until: "" });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const query = useQuery({
    enabled: !meetingId && !archives,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchLoggedMeetings({ ...filters, page: String(page) }, signal),
    queryKey: ["platform", "interview-logs", "meetings", filters, page],
    retry: 1,
    staleTime: 10_000,
  });
  if (meetingId) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <Button
          variant="ghost"
          onClick={() => {
            void navigate({ search: {} });
          }}
        >
          <IconArrowLeft className="size-4" />
          返回面试日志
        </Button>
        <MeetingTimeline key={meetingId} meetingId={meetingId} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">面试日志</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          真人面试的访问、连接、网络与离开记录。仅平台管理员可查看；按服务器接收时间排序。
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant={archives ? "outline" : "secondary"}
          aria-pressed={!archives}
          onClick={() => setArchives(false)}
        >
          事件日志
        </Button>
        <Button
          variant={archives ? "secondary" : "outline"}
          aria-pressed={archives}
          onClick={() => setArchives(true)}
        >
          长期留底档案
        </Button>
      </div>
      {archives ? (
        <MediaArchivesPanel
          onOpen={(id) => {
            void navigate({ search: { meetingId: id } });
          }}
        />
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({
                ...(search.trim() ? { search: search.trim() } : {}),
                ...(dates.since
                  ? { since: new Date(`${dates.since}T00:00:00+08:00`).toISOString() }
                  : {}),
                ...(dates.until
                  ? { until: new Date(`${dates.until}T23:59:59.999+08:00`).toISOString() }
                  : {}),
              });
              setPage(1);
            }}
          >
            <label htmlFor="telemetry-search" className="space-y-1 text-xs">
              <span className="block">会议、参与者或房间 ID</span>
              <Input
                id="telemetry-search"
                className="w-72"
                placeholder="搜索姓名或会议"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label htmlFor="telemetry-since" className="space-y-1 text-xs">
              <span className="block">开始日期（北京时间）</span>
              <Input
                id="telemetry-since"
                type="date"
                value={dates.since}
                onChange={(e) => setDates({ ...dates, since: e.target.value })}
              />
            </label>
            <label htmlFor="telemetry-until" className="space-y-1 text-xs">
              <span className="block">结束日期（北京时间）</span>
              <Input
                id="telemetry-until"
                type="date"
                value={dates.until}
                onChange={(e) => setDates({ ...dates, until: e.target.value })}
              />
            </label>
            <Button type="submit">
              <IconSearch className="size-4" />
              查询
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
            >
              <IconRefresh className="size-4" />
              刷新
            </Button>
          </form>
          {query.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {["会议", "参与身份", "浏览器指纹", "事件", "首次记录", "最近记录", ""].map(
                    (label) => (
                      <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {query.data?.records.map((row) => (
                  <tr key={row.meetingId} className="border-b last:border-0">
                    <td className="px-4 py-4">
                      <div className="font-medium">{row.meetingTitle}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{row.meetingId}</div>
                    </td>
                    <td className="px-4">{row.participantCount}</td>
                    <td className="px-4">
                      <MeetingFingerprints meeting={row} />
                    </td>
                    <td className="px-4">{row.eventCount}</td>
                    <td className="whitespace-nowrap px-4">{time(row.firstReceivedAt)}</td>
                    <td className="whitespace-nowrap px-4">{time(row.lastReceivedAt)}</td>
                    <td className="px-4">
                      <Button
                        variant="outline"
                        onClick={() => {
                          void navigate({ search: { meetingId: row.meetingId } });
                        }}
                      >
                        查看时间线
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.isPending ? (
              <p className="p-12 text-center text-muted-foreground">正在加载面试日志…</p>
            ) : null}
            {!query.isPending && !query.isError && !query.data?.records.length ? (
              <p className="p-12 text-center text-muted-foreground">
                暂无日志。采集启用后，访问真人面试邀请页面即开始记录。
              </p>
            ) : null}
          </div>
          <Pager
            page={page}
            total={query.data?.total ?? 0}
            pending={query.isFetching}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
