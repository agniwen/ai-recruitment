import { webRtcServerLabels } from "@arc/shared/interview-webrtc";
import { IpReveal } from "../security/ip-reveal";
import type { TimelineEvent } from "./api";

export function WebRtcAddress({ event }: { event: TimelineEvent }) {
  if (event.type !== "webrtc_address_collected") {
    return null;
  }
  const server = event.details.webrtcServer;
  const source =
    server === "bilibili" || server === "hitv" ? webRtcServerLabels[server] : "来源未知";
  const statuses: Record<string, string> = {
    completed: "未取得地址",
    failed: "采集失败",
    timeout: "采集超时",
    unsupported: "浏览器不支持采集",
  };
  return (
    <div className="mt-3 flex flex-col gap-1">
      <p className="text-muted-foreground">WebRTC IP · {source}</p>
      {event.hasWebRtcAddress ? (
        <IpReveal hasIp reference={{ id: event.id, kind: "webrtc", meetingId: event.meetingId }} />
      ) : (
        <p>{statuses[String(event.details.webrtcStatus)] ?? "未取得地址"}</p>
      )}
    </div>
  );
}
