import type { InferResponseType } from "hono/client";
import { rpc } from "@/lib/client/rpc";
import { apiFetch, rpcFetch } from "@/lib/client/api";

const { media } = rpc.api.platform["interview-logs"];
export type MeetingMedia = InferResponseType<(typeof media.meetings)[":meetingId"]["$get"], 200>;
export type MediaAsset = MeetingMedia["records"][number];
export type MediaArchives = InferResponseType<typeof media.$get, 200>;
export function fetchMediaArchives(page: number, search: string, signal: AbortSignal) {
  return rpcFetch<MediaArchives>(
    media.$get({ query: { page: String(page), search } }, { init: { signal } }),
    "加载留底档案失败",
  );
}
export function fetchMeetingMedia(
  meetingId: string,
  query: { page: string; status: "ready" | "issues" | "all"; kind?: "audio" | "image" },
  signal: AbortSignal,
) {
  return rpcFetch<MeetingMedia>(
    media.meetings[":meetingId"].$get({ param: { meetingId }, query }, { init: { signal } }),
    "加载音视频留底失败",
  );
}
export function deleteMediaAsset(id: string) {
  return rpcFetch(media.assets[":id"].$delete({ param: { id } }), "清理留底文件失败");
}
export function mediaContentUrl(id: string) {
  return `/api/platform/interview-logs/media/assets/${encodeURIComponent(id)}/content`;
}

export async function fetchMediaBlob(id: string, signal: AbortSignal) {
  const response = await apiFetch<Response>(mediaContentUrl(id), {
    decode: "raw",
    headers: { Accept: "application/octet-stream" },
    signal,
  });
  return response.blob();
}
