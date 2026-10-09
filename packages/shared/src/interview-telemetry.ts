import { z } from "zod";

export const interviewClientEventTypes = [
  "page_opened",
  "page_hidden",
  "page_visible",
  "page_exit",
  "page_restored",
  "component_unmounted",
  "fingerprint_ready",
  "fingerprint_failed",
  "join_requested",
  "join_failed",
  "connected",
  "connection_state_changed",
  "reconnecting",
  "reconnected",
  "disconnected",
  "leave_clicked",
  "end_requested",
  "end_failed",
  "end_completed",
  "room_error",
  "client_error",
  "network_changed",
  "network_sample",
  "heartbeat",
  "media_device_error",
  "media_device_changed",
  "track_muted",
  "track_unmuted",
  "track_published",
  "track_unpublished",
  "connection_quality_changed",
] as const;

const shortText = z.string().max(200);
const metric = z.number().finite().min(0).max(1e15);

// A closed payload: never accept arbitrary objects, URLs, tokens, SDP or device labels.
export const interviewEventDetailsSchema = z
  .object({
    browserId: z.uuid().optional(),
    bytesReceived: metric.optional(),
    bytesSent: metric.optional(),
    candidatePairId: shortText.optional(),
    deviceKind: shortText.optional(),
    downlinkMbps: metric.optional(),
    droppedEvents: z.number().int().min(0).max(1e9).optional(),
    effectiveType: shortText.optional(),
    errorCode: z.union([shortText, z.number().finite()]).optional(),
    errorName: shortText.optional(),
    estimatedRttMs: metric.optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{32,64}$/i)
      .optional(),
    fingerprintVersion: shortText.optional(),
    jitterMs: metric.optional(),
    localCandidateType: shortText.optional(),
    networkType: shortText.optional(),
    online: z.boolean().optional(),
    packetsLost: metric.optional(),
    packetsReceived: metric.optional(),
    persisted: z.boolean().optional(),
    protocol: shortText.optional(),
    quality: shortText.optional(),
    reason: shortText.optional(),
    receiveBitrate: metric.optional(),
    release: shortText.optional(),
    remoteCandidateType: shortText.optional(),
    rttMs: metric.optional(),
    sampleAvailable: z.boolean().optional(),
    saveData: z.boolean().optional(),
    sdkVersion: shortText.optional(),
    sendBitrate: metric.optional(),
    state: shortText.optional(),
    trackSource: shortText.optional(),
  })
  .strict();

export const interviewTraceSchema = z.object({
  attemptId: z.uuid().optional(),
  browserId: z.uuid().optional(),
  fingerprintId: z
    .string()
    .regex(/^[a-f0-9]{32,64}$/i)
    .optional(),
  fingerprintVersion: shortText.optional(),
  tabId: z.uuid(),
  visitId: z.uuid(),
});

export const interviewClientEventSchema = interviewTraceSchema
  .extend({
    clientSequence: z.number().int().min(1).max(2_147_483_647),
    details: interviewEventDetailsSchema,
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    participantSid: z.string().max(100).optional(),
    roomSid: z.string().max(100).optional(),
    type: z.enum(interviewClientEventTypes),
  })
  .strict();

export const interviewEventBatchSchema = z
  .object({
    events: z.array(interviewClientEventSchema).min(1).max(20),
    mode: z.enum(["candidate", "interviewer"]),
  })
  .strict();

export type InterviewTrace = z.infer<typeof interviewTraceSchema>;
export type InterviewClientEvent = z.infer<typeof interviewClientEventSchema>;
export type InterviewEventDetails = z.infer<typeof interviewEventDetailsSchema>;
export type InterviewClientEventType = InterviewClientEvent["type"];

export const interviewEventLabels: Record<string, string> = {
  client_error: "页面运行异常",
  component_unmounted: "房间组件卸载",
  connected: "连接成功",
  connection_quality_changed: "连接质量变化",
  connection_state_changed: "连接状态变化",
  disconnected: "连接断开",
  end_authorized: "服务端接受结束会议",
  end_completed: "会议结束请求成功",
  end_failed: "结束会议失败",
  end_requested: "请求结束会议",
  fingerprint_failed: "浏览器指纹采集失败",
  fingerprint_ready: "浏览器指纹采集完成",
  heartbeat: "页面心跳",
  join_failed: "入会请求失败",
  join_requested: "点击入会",
  leave_clicked: "点击离开",
  media_device_changed: "媒体设备切换",
  media_device_error: "媒体设备错误",
  network_changed: "网络状态变化",
  network_sample: "通话质量采样",
  page_exit: "页面离开",
  page_hidden: "页面进入后台",
  page_opened: "打开面试页面",
  page_restored: "页面恢复",
  page_visible: "页面回到前台",
  participant_connection_aborted: "LiveKit 连接中止",
  participant_joined: "LiveKit 参与者加入",
  participant_left: "LiveKit 参与者离开",
  reconnected: "重连成功",
  reconnecting: "正在重连",
  room_delete_failed: "房间关闭请求失败",
  room_delete_requested: "请求关闭房间",
  room_deleted: "房间关闭请求成功",
  room_error: "房间连接错误",
  room_finished: "LiveKit 房间结束",
  room_started: "LiveKit 房间开始",
  token_issued: "签发入会凭证",
  track_muted: "媒体轨道关闭",
  track_published: "开始发布媒体轨道",
  track_unmuted: "媒体轨道开启",
  track_unpublished: "停止发布媒体轨道",
};
