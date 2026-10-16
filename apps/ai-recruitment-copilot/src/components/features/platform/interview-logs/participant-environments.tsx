import type { MeetingTimeline } from "./api";
import { IpReveal } from "../security/ip-reveal";

const roles: Record<string, string> = {
  candidate: "候选人",
  host: "主持人",
  interviewer: "面试官",
  observer: "旁听",
};

function browserLabel(ua: string) {
  const browser = ua.match(/(Edg|Firefox|Chrome|CriOS|FxiOS)\/([\d.]+)/);
  const safari = ua.includes("Safari/") && ua.match(/Version\/([\d.]+)/);
  let name = ua;
  if (browser) {
    name = `${browser[1]} ${browser[2]}`;
  } else if (safari) {
    name = `Safari ${safari[1]}`;
  }
  const systems = [
    [/iPhone|iPad/, "iOS"],
    [/Android/, "Android"],
    [/Macintosh/, "macOS"],
    [/Windows/, "Windows"],
    [/Linux/, "Linux"],
  ] as const;
  const system = systems.find(([pattern]) => pattern.test(ua))?.[1];
  return [name, system].filter(Boolean).join(" · ");
}

const filterClass =
  "rounded text-left text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring";

export function ParticipantEnvironments({
  participants,
  onFilter,
  meetingId,
}: {
  participants: MeetingTimeline["participants"];
  meetingId: string;
  onFilter: (filter: { identity?: string; fingerprint?: string }) => void;
}) {
  if (!participants.length) {
    return null;
  }
  return (
    <section aria-labelledby="participant-environments-title" className="space-y-3">
      <div>
        <h3 id="participant-environments-title" className="font-semibold">
          参与者与浏览器
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          汇总整场会议，不受下方事件筛选影响。点击姓名、指纹可筛选相关事件；IP 需要点击查看。
          同一行的多个值不代表一一对应的设备；精确关联请查看访问 ID。
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table aria-label="参与者与浏览器" className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {["参与者", "浏览器 / 系统", "浏览器指纹", "来源 IP", "访问 / 入会"].map((label) => (
                <th key={label} className="px-4 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {participants.map((participant) => (
              <tr
                key={participant.identity}
                className="border-b align-top last:border-0 [&_td]:px-4 [&_td]:py-3"
              >
                <td className="min-w-36">
                  <button
                    type="button"
                    className={filterClass}
                    onClick={() => onFilter({ identity: participant.identity })}
                  >
                    {participant.name || participant.identity}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {roles[participant.role ?? ""] ?? "角色未知"}
                  </p>
                </td>
                <td className="min-w-40 max-w-64 break-words text-xs">
                  {participant.userAgents.length
                    ? participant.userAgents.map((ua) => (
                        <p key={ua} title={ua} className="mb-1">
                          {browserLabel(ua)}
                        </p>
                      ))
                    : "尚无浏览器信息"}
                  <span className="text-muted-foreground">
                    浏览器标识 {participant.browserIds.length} 个
                  </span>
                </td>
                <td className="min-w-56">
                  {participant.fingerprints.length ? (
                    participant.fingerprints.map((fingerprint) => (
                      <button
                        key={fingerprint}
                        type="button"
                        aria-label={`按指纹 ${fingerprint} 查看事件`}
                        className={`${filterClass} block break-all font-mono text-[11px]`}
                        onClick={() => onFilter({ fingerprint })}
                      >
                        {fingerprint}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">尚无指纹记录</span>
                  )}
                </td>
                <td className="min-w-32 font-mono text-xs">
                  {participant.ipEventIds.length
                    ? participant.ipEventIds.map((id) => (
                        <IpReveal key={id} hasIp reference={{ id, kind: "telemetry", meetingId }} />
                      ))
                    : "IP 未采集"}
                </td>
                <td className="min-w-24 whitespace-nowrap text-xs tabular-nums">
                  {participant.visits} 次访问 · {participant.attempts} 次入会尝试
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
