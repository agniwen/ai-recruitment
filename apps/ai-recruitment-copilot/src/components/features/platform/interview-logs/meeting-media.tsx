/* oxlint-disable next/no-img-element -- TanStack app; authenticated previews must not use an image proxy. */
/* oxlint-disable jsx-a11y/media-has-caption -- Raw audio evidence has no generated transcript; labeled native playback controls are provided. */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { IconRefresh, IconPhoto, IconMicrophone, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";
import { deleteMediaAsset, fetchMeetingMedia, fetchMediaBlob } from "./media-api";
import type { MediaAsset } from "./media-api";
import { IpReveal } from "../security/ip-reveal";

const formatTime = (date: string) =>
  new Date(date).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
const statusLabels: Record<string, string> = {
  deleted: "已清理",
  failed: "采集失败",
  pending: "采集中",
  ready: "已保存",
  skipped: "未采集",
};
const reasonLabels: Record<string, string> = {
  camera_off: "未开启摄像头",
  capture_interrupted: "采集被中断，未完成保存",
  capture_or_storage_failed: "采集或存储失败",
  lease_lost: "采样任务已被其他 Worker 接管或会议已结束",
  lease_renew_failed: "数据库续租失败，采样已停止",
  microphone_off: "未发布麦克风音轨",
  no_audio_frames: "未收到足够音频数据",
  no_video_frames: "未收到摄像头画面",
  rtc_connect_failed: "采样器连接会议失败",
  rtc_disconnected: "采样器连接中断",
  track_muted: "音视频轨道已静音",
  track_subscription_timeout: "订阅媒体超时",
};
const captureStatusLabels: Record<string, string> = {
  capturing: "采样中",
  error: "采样异常",
  stopped: "采样已停止",
  waiting: "等待采样 Worker",
};
const kindLabels = { all: "全部类型", audio: "音频", image: "截图" };
const roleLabels: Record<string, string> = {
  candidate: "候选人",
  host: "主持人",
  interviewer: "面试官",
  observer: "旁听",
  unknown: "未知身份",
};

function MediaPreview({ asset, onClose }: { asset: MediaAsset | null; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<string>();
  const content = useQuery({
    enabled: !!asset,
    gcTime: 0,
    queryFn: ({ signal }) => fetchMediaBlob(asset?.id ?? "", signal),
    queryKey: ["platform", "interview-media-content", asset?.id],
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    if (!content.data) {
      return;
    }
    const url = URL.createObjectURL(content.data);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [content.data]);
  return (
    <Dialog
      open={!!asset}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {asset?.participantName} · {asset?.kind === "audio" ? "音频片段" : "摄像头截图"}
          </DialogTitle>
          <DialogDescription>
            {asset ? formatTime(asset.capturedAt) : ""}（北京时间）
          </DialogDescription>
        </DialogHeader>
        {asset ? (
          <div className="space-y-3">
            {failed || content.isError ? (
              <p role="alert" className="text-sm text-destructive">
                文件暂时无法打开，请关闭后重试；也可能已被其他管理员清理。
              </p>
            ) : null}
            {content.isPending ? (
              <p className="text-sm text-muted-foreground">正在加载文件…</p>
            ) : null}
            {source && asset.kind === "image" ? (
              <img
                className="max-h-[65vh] w-full rounded-lg object-contain"
                src={source}
                alt={`${asset.participantName}的面试摄像头截图`}
                onError={() => setFailed(true)}
              />
            ) : null}
            {source && asset.kind === "audio" ? (
              <audio
                className="w-full"
                controls
                preload="metadata"
                src={source}
                onError={() => setFailed(true)}
                aria-label={`${asset.participantName}的面试音频片段`}
              />
            ) : null}
            <p className="break-all text-xs text-muted-foreground">
              SHA-256：{asset.sha256 ?? "—"}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MeetingMediaPanel({ meetingId }: { meetingId: string }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"audio" | "image" | undefined>();
  const [status, setStatus] = useState<"ready" | "issues" | "all">("ready");
  const [preview, setPreview] = useState<MediaAsset | null>(null);
  const [deleting, setDeleting] = useState<MediaAsset | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryFn: ({ signal }) =>
      fetchMeetingMedia(meetingId, { kind, page: String(page), status }, signal),
    queryKey: ["platform", "interview-media", meetingId, { kind, page, status }],
    retry: 1,
    staleTime: 10_000,
  });
  const remove = useMutation({
    mutationFn: deleteMediaAsset,
    onError: (error) => toast.error(error.message),
    onSuccess: async () => {
      setDeleting(null);
      toast.success("留底文件已清理，删除记录已保留");
      await client.invalidateQueries({ queryKey: ["platform", "interview-media", meetingId] });
    },
  });
  const counts = query.data?.counts ?? [];
  const saved = (type: string) =>
    counts.find((c) => c.kind === type && c.status === "ready")?.count ?? 0;
  return (
    <section className="space-y-4 rounded-xl border p-4" aria-label="音视频留底">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">
          音视频留底{" "}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            截图 {saved("image")} · 音频 {saved("audio")}
          </span>
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <IconRefresh className="size-4" />
          刷新留底
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        每人每 2 分钟采样最多 15 秒音频；开启摄像头时每 30
        秒保存一张截图。长期保留，由平台管理员手动清理。设备标识和指纹来自浏览器，不能单独证明人员身份。
      </p>
      {query.data?.rooms.map((room) => (
        <p key={room.roomSid} className="break-all text-xs text-muted-foreground">
          {room.meetingTitle} · {captureStatusLabels[room.status]}
          {room.heartbeatAt ? ` · 最近心跳 ${formatTime(room.heartbeatAt)}` : ""}
          {room.status === "capturing" &&
          (!room.heartbeatAt || Date.now() - new Date(room.heartbeatAt).getTime() > 45_000)
            ? " · 心跳过期，请检查 Worker"
            : ""}
          {room.errorCode ? ` · ${reasonLabels[room.errorCode] ?? room.errorCode}` : ""}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        {([undefined, "image", "audio"] as const).map((value) => (
          <Button
            key={value ?? "all"}
            size="sm"
            variant={kind === value ? "secondary" : "outline"}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setPage(1);
            }}
          >
            {kindLabels[value ?? "all"]}
          </Button>
        ))}
        <select
          aria-label="留底记录状态"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="ready">已保存的文件</option>
          <option value="issues">未采集 / 异常</option>
          <option value="all">全部（含已清理）</option>
        </select>
      </div>
      {query.isPending ? <p className="text-sm text-muted-foreground">正在加载留底…</p> : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {query.data && !query.data.records.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          暂无符合条件的留底。仅启用采样后产生文件；可切换“未采集 / 异常”查看缺失原因。
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {query.data?.records.map((asset) => (
          <article key={asset.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium">
                  {asset.participantName}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {roleLabels[asset.participantRole] ?? asset.participantRole}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTime(asset.capturedAt)} ·{" "}
                  {asset.kind === "image"
                    ? "截图"
                    : `${((asset.durationMs ?? 0) / 1000).toFixed(1)} 秒音频`}
                </p>
              </div>
              <Badge variant={asset.status === "ready" ? "secondary" : "outline"}>
                {statusLabels[asset.status]}
              </Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">设备标识</dt>
              <dd className="break-all font-mono">{asset.environment.browserId || "未采集"}</dd>
              <dt className="text-muted-foreground">浏览器指纹</dt>
              <dd className="break-all font-mono">{asset.environment.fingerprint || "未采集"}</dd>
              <dt className="text-muted-foreground">IP</dt>
              <dd>
                <IpReveal
                  hasIp={asset.environment.hasIp}
                  reference={{ id: asset.id, kind: "media", meetingId: asset.meetingId }}
                />
              </dd>
            </dl>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">连接与浏览器信息</summary>
              <dl className="mt-2 space-y-1 break-all">
                <div>身份：{asset.participantIdentity}</div>
                <div>连接 SID：{asset.participantSid}</div>
                <div>房间 SID：{asset.roomSid}</div>
                <div>入会尝试：{asset.environment.attemptId || "—"}</div>
                <div>
                  访问 / 标签页：{asset.environment.visitId || "—"} /{" "}
                  {asset.environment.tabId || "—"}
                </div>
                <div>浏览器：{asset.environment.userAgent || "—"}</div>
                <div>IP 来源：{asset.environment.ipSource || "—"}</div>
              </dl>
            </details>
            {asset.errorCode ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {reasonLabels[asset.errorCode] ?? asset.errorCode}
              </p>
            ) : null}
            {asset.deletedAt ? (
              <p className="text-xs text-muted-foreground">
                清理于 {formatTime(asset.deletedAt)} · 管理员 {asset.deletedBy}
              </p>
            ) : null}
            <div className="flex gap-2">
              {asset.status === "ready" ? (
                <Button size="sm" variant="outline" onClick={() => setPreview(asset)}>
                  {asset.kind === "image" ? (
                    <IconPhoto className="size-4" />
                  ) : (
                    <IconMicrophone className="size-4" />
                  )}
                  {asset.kind === "image" ? "查看截图" : "播放音频"}
                </Button>
              ) : null}
              {["ready", "failed"].includes(asset.status) ? (
                <Button size="sm" variant="ghost" onClick={() => setDeleting(asset)}>
                  <IconTrash className="size-4" />
                  清理文件
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {query.data ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            共 {query.data.total} 条 · 第 {page} 页
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 1 || query.isFetching}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page * 30 >= query.data.total || query.isFetching}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
      <MediaPreview
        key={preview?.id ?? "closed"}
        asset={preview}
        onClose={() => setPreview(null)}
      />
      <EntityDeleteDialog
        record={deleting}
        title="清理这份留底文件？"
        description="清理后无法再查看或播放此文件。参与者、设备信息及管理员清理记录仍会保留。"
        confirmLabel="确认清理"
        isPending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting && !remove.isPending) {
            remove.mutate(deleting.id);
          }
        }}
      />
    </section>
  );
}
