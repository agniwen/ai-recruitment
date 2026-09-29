// @vitest-environment jsdom
import { act, createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanMeetingRoom } from "./human-meeting-room";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const live = vi.hoisted(() => ({
  speaking: false,
  tracks: [] as { source: string; participant: { identity: string; name: string } }[],
}));
const TrackContext = createContext(live.tracks[0]);
vi.mock("@livekit/components-react", () => ({
  ConnectionQualityIndicator: () => null,
  DisconnectButton: () => null,
  LiveKitRoom: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ParticipantName: ({ participant }: { participant: { name: string } }) => (
    <span>{participant.name}</span>
  ),
  ParticipantTile: () => null,
  RoomAudioRenderer: () => null,
  TrackLoop: ({ tracks, children }: { tracks: typeof live.tracks; children: ReactNode }) =>
    tracks.map((track) => (
      <TrackContext.Provider key={`${track.participant.identity}:${track.source}`} value={track}>
        {children}
      </TrackContext.Provider>
    )),
  TrackMutedIndicator: () => null,
  TrackToggle: () => null,
  useIsSpeaking: () => live.speaking,
  useParticipants: () => [],
  useRoomContext: () => ({ off: vi.fn(), on: vi.fn(), state: "disconnected" }),
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
afterEach(() => {
  act(() => root?.unmount());
  live.speaking = false;
  host.remove();
  vi.unstubAllGlobals();
});

async function enter() {
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          participantName: "张三",
          participantRole: "candidate",
          participantToken: "token",
          serverUrl: "wss://example.test",
        }),
      ok: true,
    }),
  );
  act(() =>
    root.render(
      <HumanMeetingRoom
        inviteToken="invite"
        mode="candidate"
        preview={{
          candidateName: "张三",
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
