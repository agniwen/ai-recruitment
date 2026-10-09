// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicHumanInterviewMeetingPreview } from "@arc/shared/studio-pipeline-stages";
import { act, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanMeetingRoom } from "./human-meeting-room";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const live = vi.hoisted(() => ({
  connectionState: "disconnected",
  room: {
    localParticipant: { getTrackPublication: vi.fn(), setMicrophoneEnabled: vi.fn() },
  },
  speaking: false,
  tracks: [] as { source: string; participant: { identity: string; name: string } }[],
}));
const TrackContext = createContext(live.tracks[0]);
vi.mock("./meeting-telemetry-observer", () => ({ MeetingTelemetryObserver: () => null }));
vi.mock("./use-meeting-telemetry", () => ({
  useMeetingTelemetry: () => ({
    emit: vi.fn(),
    flush: vi.fn(),
    headers: () => ({}),
    startAttempt: vi.fn(),
  }),
}));
vi.mock("@livekit/components-react", () => ({
  ConnectionQualityIndicator: () => null,
  DisconnectButton: () => null,
  LiveKitRoom: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ParticipantName: ({ participant }: { participant: { name: string } }) => (
    <span>{participant.name}</span>
  ),
  ParticipantTile: () => null,
  RoomAudioRenderer: () => null,
  StartAudio: ({ label }: { label: string }) => <button type="button">{label}</button>,
  TrackLoop: ({ tracks, children }: { tracks: typeof live.tracks; children: ReactNode }) =>
    tracks.map((track) => (
      <TrackContext.Provider key={`${track.participant.identity}:${track.source}`} value={track}>
        {children}
      </TrackContext.Provider>
    )),
  TrackMutedIndicator: () => null,
  TrackToggle: () => null,
  useConnectionState: () => live.connectionState,
  useIsSpeaking: () => live.speaking,
  useLocalParticipant: () => ({ isMicrophoneEnabled: false }),
  useParticipants: () => [],
  useRoomContext: () => live.room,
  useTrackRefContext: () => useContext(TrackContext),
  useTracks: () => live.tracks,
}));
vi.mock("./human-meeting-audio-controls", () => ({
  MicrophoneDeviceMenu: () => null,
  VoiceEffectMenu: () => null,
}));
vi.mock("./human-meeting-chat", () => ({
  HumanMeetingChat: ({ open }: { open: boolean }) => (open ? <div>会议聊天面板</div> : null),
}));
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;
const preview: PublicHumanInterviewMeetingPreview = {
  candidateName: "张三",
  entryAccess: { canJoin: true, reason: null, recheckAfterMs: null },
  meetingId: "meeting",
  roundLabel: "初试",
  scheduledAt: "2026-09-30T08:00:00.000Z",
  status: "scheduled",
  title: "技术面试",
  validUntil: "2026-09-30T09:00:00.000Z",
};
beforeEach(() => {
  live.connectionState = "disconnected";
  live.room.localParticipant.setMicrophoneEnabled.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getAudioTracks: () => [{ readyState: "live" }],
        getTracks: () => [{ stop: vi.fn() }],
      }),
    },
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
function renderRoom(element: ReactNode) {
  root.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}
afterEach(() => {
  act(() => root?.unmount());
  live.speaking = false;
  host.remove();
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

async function enter() {
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((_url, init) =>
      Promise.resolve(
        Response.json(
          init?.method === "GET"
            ? preview
            : {
                participantName: "张三",
                participantRole: "candidate",
                participantToken: "token",
                serverUrl: "wss://example.test",
              },
        ),
      ),
    ),
  );
  act(() =>
    renderRoom(
      <HumanMeetingRoom
        inviteToken="invite"
        mode="candidate"
        preview={{
          candidateName: "张三",
          entryAccess: { canJoin: true, reason: null, recheckAfterMs: null },
          meetingId: "meeting",
          roundLabel: "初试",
          scheduledAt: null,
          status: "in_progress",
          title: "技术面试",
          validUntil: "2099-01-01T00:00:00Z",
        }}
      />,
    ),
  );
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("进入会议"))
      ?.click();
    await Promise.resolve();
  });
}
function clickText(text: string) {
  act(() => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === text)?.click();
  });
}
describe("human meeting layouts", () => {
  it("defaults to focus layout, switches the main participant and opens chat", async () => {
    live.tracks = [
      { participant: { identity: "candidate", name: "张三" }, source: "camera" },
      { participant: { identity: "interviewer", name: "李老师" }, source: "camera" },
    ];
    await enter();
    expect(host.querySelector('[data-slot="meeting-focus-layout"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[title="设为主画面"]')?.click());
    expect(host.querySelector('[data-slot="meeting-focus-layout"]')).not.toBeNull();
    expect(host.querySelector('aside[aria-label="其他参会画面"]')?.textContent).toContain("张三");
    expect(host.textContent).not.toContain("网格视图");
    expect(host.textContent).toContain("点击开启会议声音");
    expect(host.querySelector('[data-slot="meeting-focus-layout"]')).not.toBeNull();
    clickText("聊天");
    expect(host.textContent).toContain("会议聊天面板");
  });
  it("highlights speaking camera tiles but not screen shares, and clears the border when speech stops", async () => {
    live.speaking = true;
    live.tracks = [
      { participant: { identity: "candidate", name: "张三" }, source: "camera" },
      { participant: { identity: "candidate", name: "张三" }, source: "screen_share" },
    ];
    await enter();
    expect(host.querySelectorAll('[data-speaking="true"]')).toHaveLength(1);
    expect(host.querySelector('[data-speaking="true"]')?.className).toContain("border-emerald-400");
    expect(
      host.querySelector<HTMLElement>('[data-slot="meeting-focus-layout"] [data-speaking]')?.dataset
        .speaking,
    ).toBe("false");
    live.speaking = false;
    clickText("聊天");
    expect(host.querySelector('[data-speaking="true"]')).toBeNull();
  });
  it("restores automatic screen-share focus after manually selecting a camera", async () => {
    live.tracks = [
      { participant: { identity: "candidate", name: "张三" }, source: "camera" },
      { participant: { identity: "interviewer", name: "李老师" }, source: "screen_share" },
    ];
    await enter();
    expect(host.textContent).not.toContain("自动布局");
    act(() => host.querySelector<HTMLButtonElement>('button[title="设为主画面"]')?.click());
    expect(host.textContent).toContain("自动布局");
    expect(
      host.querySelector('[data-slot="meeting-focus-layout"]')?.firstElementChild?.textContent,
    ).toContain("张三");
    clickText("自动布局");
    expect(host.textContent).not.toContain("自动布局");
    expect(
      host.querySelector('[data-slot="meeting-focus-layout"]')?.firstElementChild?.textContent,
    ).toContain("屏幕共享");
  });
  it("automatically focuses screen sharing and falls back after sharing ends", async () => {
    live.tracks = [
      { participant: { identity: "candidate", name: "张三" }, source: "camera" },
      { participant: { identity: "interviewer", name: "李老师" }, source: "screen_share" },
    ];
    await enter();
    expect(
      host.querySelector('[data-slot="meeting-focus-layout"]')?.firstElementChild?.textContent,
    ).toContain("屏幕共享");
    live.tracks = live.tracks.slice(0, 1);
    clickText("聊天");
    expect(host.querySelector('[data-slot="meeting-focus-layout"]')?.textContent).toContain("张三");
    expect(host.querySelector('[data-slot="meeting-focus-layout"]')).not.toBeNull();
  });
});

async function renderEntry(initialPreview = preview) {
  document.body.append(host);
  root = createRoot(host);
  await act(() => {
    renderRoom(<HumanMeetingRoom mode="candidate" inviteToken="invite" preview={initialPreview} />);
  });
}
function entryButton() {
  return [...host.querySelectorAll("button")].find((button) =>
    /进入会议|未到入会时间|暂不可入会/.test(button.textContent ?? ""),
  );
}
async function flushQueryUpdates() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

describe("server-controlled meeting entry", () => {
  it.each([-3_600_000, 3_600_000])("ignores a device clock offset of %i ms", async (offset) => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-30T08:00:00Z") + offset);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(preview)));
    await renderEntry();
    await flushQueryUpdates();
    expect(entryButton()?.disabled).toBe(false);
    expect(host.textContent).toContain("2026/09/30 16:00");
    expect(host.textContent).toContain("北京时间");
  });

  it("uses the interviewer preview endpoint with a slow Vietnam device clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-30T14:00:00+07:00");
    const interviewerPreview = {
      ...preview,
      interviewerName: "测试面试官",
      role: "interviewer" as const,
    };
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(interviewerPreview)));
    vi.stubGlobal("fetch", fetchMock);
    document.body.append(host);
    root = createRoot(host);
    await act(() => {
      renderRoom(
        <HumanMeetingRoom
          mode="interviewer"
          inviteToken="interviewer-invite"
          preview={interviewerPreview}
        />,
      );
    });
    await flushQueryUpdates();
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/human-interview-meetings/interviewer/interviewer-invite",
    );
    expect(entryButton()?.disabled).toBe(false);
    expect(host.textContent).toContain("2026/09/30 16:00");
  });

  it("rechecks server state when the page returns from the background", async () => {
    vi.useFakeTimers();
    const waiting = {
      ...preview,
      entryAccess: { canJoin: false, reason: "too_early" as const, recheckAfterMs: 30_000 },
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(waiting)));
    vi.stubGlobal("fetch", fetchMock);
    await renderEntry(waiting);
    await flushQueryUpdates();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(preview)));
    visibility.mockReturnValue("visible");
    await act(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await flushQueryUpdates();
    expect(entryButton()?.disabled).toBe(false);
  });

  it("shortens polling from ten minutes to two minutes to thirty seconds", async () => {
    vi.useFakeTimers();
    let remaining = 3 * 60 * 60_000;
    const response = () => ({
      ...preview,
      entryAccess: { canJoin: false, reason: "too_early" as const, recheckAfterMs: remaining },
    });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(response())));
    vi.stubGlobal("fetch", fetchMock);
    await renderEntry(response());
    await flushQueryUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599_998);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    remaining = 10 * 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    remaining = 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(entryButton()?.disabled).toBe(true);
  });

  it("keeps entry blocked until the server allows it, then opens automatically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-30T09:00:00Z");
    const waiting = {
      ...preview,
      entryAccess: { canJoin: false, reason: "too_early" as const, recheckAfterMs: 1000 },
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(waiting)));
    vi.stubGlobal("fetch", fetchMock);
    await renderEntry(waiting);
    await flushQueryUpdates();
    expect(entryButton()?.disabled).toBe(true);
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(preview)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_998);
    });
    expect(entryButton()?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(entryButton()?.disabled).toBe(false);
  });

  it("recovers from a failed status request through the manual check", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await renderEntry();
    await flushQueryUpdates();
    expect(entryButton()?.disabled).toBe(true);
    expect(host.textContent).toContain("检查入会状态失败");
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(preview)));
    await act(() => {
      clickText("检查入会状态");
    });
    await flushQueryUpdates();
    expect(entryButton()?.disabled).toBe(false);
  });

  it("refreshes on focus and respects a cancelled meeting", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(preview)));
    vi.stubGlobal("fetch", fetchMock);
    await renderEntry();
    await flushQueryUpdates();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        Response.json({
          ...preview,
          entryAccess: { canJoin: false, reason: "closed", recheckAfterMs: null },
          status: "cancelled",
        }),
      ),
    );
    await act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flushQueryUpdates();
    expect(entryButton()?.disabled).toBe(true);
    expect(host.textContent).toContain("已结束或取消");
  });
});

describe("microphone preflight integration", () => {
  it("requests a token only after explicit entry and preserves the microphone error in the room", async () => {
    live.connectionState = "connected";
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException("blocked", "NotAllowedError"),
    );
    await enter();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "麦克风权限未开放",
    );
    await act(() => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "仍然进入（麦克风不可用）")
        ?.click();
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(live.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(host.textContent).toContain("麦克风权限未开放");
    expect(host.textContent).toContain("其他人暂时听不到你");
  });
});
