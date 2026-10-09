// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionState, Track } from "livekit-client";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { MeetingMicrophoneNotice, useMeetingMicrophone } from "./human-meeting-microphone";

const live = vi.hoisted(() => ({
  enabled: false,
  room: {
    localParticipant: {
      getTrackPublication: vi.fn(),
      setMicrophoneEnabled: vi.fn(),
    },
  },
  state: "connected",
}));
vi.mock("@livekit/components-react", () => ({
  useConnectionState: () => live.state,
  useLocalParticipant: () => ({ isMicrophoneEnabled: live.enabled }),
  useRoomContext: () => live.room,
}));

enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;

function MicrophoneTest({
  canPublish = true,
  preflightError = null,
}: {
  canPublish?: boolean;
  preflightError?: Error | null;
}) {
  const microphone = useMeetingMicrophone(canPublish, preflightError);
  return (
    <>
      <MeetingMicrophoneNotice microphone={microphone} />
      <button
        type="button"
        onClick={() => microphone.onError(new DOMException("blocked", "NotAllowedError"))}
      >
        模拟工具栏开启失败
      </button>
    </>
  );
}

beforeEach(() => {
  live.enabled = false;
  live.state = ConnectionState.Connected;
  live.room.localParticipant.getTrackPublication.mockReset();
  live.room.localParticipant.setMicrophoneEnabled.mockReset().mockImplementation(() => {
    live.enabled = true;
    return Promise.resolve();
  });
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  document.body.innerHTML = "";
});

async function rerender() {
  await act(() => {
    rendered?.root.render(<MicrophoneTest />);
  });
}

describe("human meeting microphone feedback", () => {
  it("enables the default microphone once after connecting", async () => {
    live.state = ConnectionState.Connecting;
    rendered = await renderInAct(<MicrophoneTest />);
    expect(live.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    live.state = ConnectionState.Connected;
    await rerender();
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledExactlyOnceWith(true, {
      deviceId: "default",
    });
    expect(rendered.container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("does not request microphone access for observers", async () => {
    rendered = await renderInAct(<MicrophoneTest canPublish={false} />);
    expect(live.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(rendered.container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("honors entry without a microphone and only requests permission again on manual retry", async () => {
    rendered = await renderInAct(
      <MicrophoneTest preflightError={new DOMException("blocked", "NotAllowedError")} />,
    );
    expect(live.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toContain("麦克风权限未开放");
    await act(() => {
      rendered?.container.querySelector<HTMLButtonElement>('[aria-live="polite"] button')?.click();
    });
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledOnce();
    expect(rendered.container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it.each([
    ["NotAllowedError", "麦克风权限未开放", "浏览器地址栏"],
    ["NotFoundError", "未检测到麦克风", "连接麦克风"],
    ["NotReadableError", "麦克风无法使用", "占用麦克风"],
    ["NotSupportedError", "当前环境无法使用麦克风", "HTTPS"],
    ["OverconstrainedError", "所选麦克风不可用", "选择可用设备"],
    ["UnknownError", "麦克风开启失败", "重新开启"],
  ])("keeps actionable feedback for %s and lets the user retry", async (name, title, help) => {
    live.room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new DOMException("raw browser error", name),
    );
    rendered = await renderInAct(<MicrophoneTest />);
    expect(rendered.container.textContent).toContain(title);
    expect(rendered.container.textContent).toContain(help);
    expect(rendered.container.textContent).toContain("其他人暂时听不到你");
    expect(rendered.container.textContent).not.toContain("raw browser error");
    await rerender();
    expect(rendered.container.textContent).toContain(title);
    await act(() => {
      rendered?.container.querySelector<HTMLButtonElement>('[aria-live="polite"] button')?.click();
    });
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(2);
    expect(rendered.container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("shows a pending permission prompt, prevents repeated starts, and settles in StrictMode", async () => {
    const pending = Promise.withResolvers<null>();
    live.room.localParticipant.setMicrophoneEnabled.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(
      <StrictMode>
        <MicrophoneTest />
      </StrictMode>,
    );
    const button = rendered.container.querySelector<HTMLButtonElement>(
      '[aria-live="polite"] button',
    );
    expect(rendered.container.textContent).toContain("请在浏览器提示中允许使用");
    expect(button?.disabled).toBe(true);
    await act(() => {
      button?.click();
    });
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    await act(() => {
      live.enabled = true;
      pending.resolve(null);
    });
    expect(rendered.container.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("keeps intentional mute through reconnect and only unmutes on user action", async () => {
    rendered = await renderInAct(<MicrophoneTest />);
    live.enabled = false;
    await rerender();
    expect(rendered.container.textContent).toContain("麦克风已关闭");
    live.state = ConnectionState.Reconnecting;
    await rerender();
    live.state = ConnectionState.Connected;
    await rerender();
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    expect(rendered.container.textContent).toContain("麦克风已关闭");
    await act(() => {
      rendered?.container.querySelector<HTMLButtonElement>('[aria-live="polite"] button')?.click();
    });
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(2);
  });

  it("preserves the chosen device when retrying an existing microphone track", async () => {
    live.room.localParticipant.getTrackPublication.mockReturnValue({ isMuted: true });
    rendered = await renderInAct(<MicrophoneTest />);
    expect(live.room.localParticipant.getTrackPublication).toHaveBeenCalledWith(
      Track.Source.Microphone,
    );
    expect(live.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true, undefined);
  });

  it("displays errors from a later toolbar attempt and clears stale errors after recovery", async () => {
    rendered = await renderInAct(<MicrophoneTest />);
    live.enabled = false;
    await act(() => {
      rendered?.container.querySelector<HTMLButtonElement>("button:last-child")?.click();
    });
    expect(rendered.container.textContent).toContain("麦克风权限未开放");
    live.enabled = true;
    await rerender();
    live.enabled = false;
    await rerender();
    expect(rendered.container.textContent).toContain("麦克风已关闭");
    expect(rendered.container.textContent).not.toContain("麦克风权限未开放");
  });
});
