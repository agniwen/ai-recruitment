import { useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TimeDisplay } from "@/components/features/display/time-display";
import { IpReveal } from "../security/ip-reveal";

const endpoint = rpc.api.platform["interview-logs"][":meetingId"]["entry-credentials"];
type MeetingCredentials = InferResponseType<typeof endpoint.$get, 200>;

export function MeetingEntryCredentials({ meetingId }: { meetingId: string }) {
  const query = useQuery({
    queryFn: ({ signal }) =>
      rpcFetch<MeetingCredentials>(
        endpoint.$get({ param: { meetingId } }, { init: { signal } }),
        "加载入场凭据失败",
      ),
    queryKey: ["platform", "meeting-entry-credentials", meetingId],
    staleTime: 0,
  });
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">候选人入场凭据</h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          {query.isFetching ? "加载中…" : "刷新"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        关联统计限同一工作空间。相同凭据可能同步或共享，凭据数量不代表设备或人数；浏览器标识和指纹为客户端上报。
      </p>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {query.data?.records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无验证记录。未开启、HR 已单独关闭或尚未完成验证时不会产生凭据关联。
        </p>
      ) : null}
      {query.data?.records.map((record) => (
        <details
          key={`${record.organizationId}:${record.credentialRef}`}
          className="rounded-md border p-3"
        >
          <summary className="cursor-pointer space-y-2 text-sm">
            <span className="break-all font-mono">{record.credentialRef}</span>
            {record.summary.candidates > 1 ? (
              <Badge variant="outline" className="ms-2">
                多个候选人记录使用，建议复核
              </Badge>
            ) : null}
            <span className="block text-muted-foreground">
              候选人记录 {record.summary.candidates} · 面试 {record.summary.meetings} · 浏览器标识{" "}
              {record.summary.browsers} · 浏览器指纹 {record.summary.fingerprints} · 验证{" "}
              {record.summary.uses} 次
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {record.associations.map((use) => (
              <div key={use.id} className="space-y-1 border-t pt-3 text-xs">
                <p>
                  {use.candidateName} · <TimeDisplay value={use.createdAt} /> ·{" "}
                  {use.method === "register" ? "首次创建" : "验证已有凭据"}
                  {use.meetingId === meetingId ? " · 当前会议" : ""}
                </p>
                <p>
                  凭据属性：{use.properties.backupEligible ? "可备份 / 同步" : "不支持备份"}；
                  {use.properties.backedUp ? "已备份" : "未报告已备份"}
                </p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all text-muted-foreground">
                  <dt>候选人记录</dt>
                  <dd>{use.candidateId}</dd>
                  <dt>会议</dt>
                  <dd>{use.meetingId}</dd>
                  <dt>浏览器标识</dt>
                  <dd>{use.browserId ?? "未获取"}</dd>
                  <dt>浏览器指纹</dt>
                  <dd>{use.fingerprintId ?? "验证时未获取，可按本次访问编号查面试日志"}</dd>
                  <dt>访问编号</dt>
                  <dd>{use.visitId}</dd>
                  <dt>来源 IP</dt>
                  <dd>
                    <IpReveal
                      hasIp={use.hasIp}
                      reference={{ id: use.id, kind: "entry-use", meetingId: use.meetingId }}
                    />
                  </dd>
                  <dt>浏览器信息</dt>
                  <dd>{use.userAgent ?? "未获取"}</dd>
                </dl>
              </div>
            ))}
            {record.truncated ? (
              <p className="text-xs text-muted-foreground">
                展示最近 50 条关联，统计包含全部记录。
              </p>
            ) : null}
          </div>
        </details>
      ))}
      {query.data?.truncated ? (
        <p className="text-xs text-muted-foreground">
          本场展示最近使用的 20 个凭据，其余可按会议编号查询数据库。
        </p>
      ) : null}
    </section>
  );
}
