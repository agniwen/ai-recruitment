import type { InferResponseType } from "hono/client";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";

const logs = rpc.api.platform["interview-logs"];
export type MeetingLogs = InferResponseType<typeof logs.$get, 200>;
export type MeetingTimeline = InferResponseType<(typeof logs)[":meetingId"]["$get"], 200>;
export type TimelineEvent = MeetingTimeline["records"][number];

export function fetchLoggedMeetings(query: Record<string, string>, signal: AbortSignal) {
  return rpcFetch<MeetingLogs>(logs.$get({ query }, { init: { signal } }), "加载面试日志失败");
}
export function fetchMeetingTimeline(
  meetingId: string,
  query: Record<string, string>,
  signal: AbortSignal,
) {
  return rpcFetch<MeetingTimeline>(
    logs[":meetingId"].$get({ param: { meetingId }, query }, { init: { signal } }),
    "加载会议时间线失败",
  );
}
