// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicHumanInterviewMeetingPreview } from "@arc/shared/studio-pipeline-stages";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { MeetingJoinButton } from "./human-meeting-join-button";

enableReactActEnvironment();
const preview: PublicHumanInterviewMeetingPreview = {
  candidateName: "测试候选人",
  entryAccess: { canJoin: true, reason: null, recheckAfterMs: null },
  meetingId: "test-meeting",
  roundLabel: "初试",
  scheduledAt: null,
  status: "in_progress",
  title: "测试面试",
  validUntil: null,
};
const getUserMedia = vi.fn();
const stop = vi.fn();
const onJoin = vi.fn();
const onCheckError = vi.fn();
const stream = {
  getAudioTracks: () => [{ readyState: "live" }],
  getTracks: () => [{ stop }],
};
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
beforeEach(() => {
  getUserMedia.mockReset().mockResolvedValue(stream);
  stop.mockClear();
  onJoin.mockReset().mockResolvedValue(null);
  onCheckError.mockClear();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  document.body.replaceChildren();
  Reflect.deleteProperty(navigator, "mediaDevices");
});
function button(label: string) {
  const element = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!element) {
    throw new Error(`Missing button: ${label}`);
  }
  return element;
}
async function click(label: string) {
  await act(() => button(label).click());
}
function view(disabled = false) {
  return (
    <MeetingJoinButton
      disabled={disabled}
      isJoining={false}
      label="进入会议"
      preview={preview}
      onJoin={onJoin}
      onCheckError={onCheckError}
    />
  );
}

describe("meeting entry microphone check", () => {
  it("checks on click and releases the temporary stream before joining", async () => {
    rendered = await renderInAct(view());
    expect(getUserMedia).not.toHaveBeenCalled();
    onJoin.mockImplementation(() => {
      expect(stop).toHaveBeenCalledOnce();
      return Promise.resolve();
    });
    await click("进入会议");
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true, video: false });
    expect(onJoin).toHaveBeenCalledExactlyOnceWith(null);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it.each([
    ["NotAllowedError", "麦克风权限未开放"],
    ["NotFoundError", "未检测到麦克风"],
    ["NotReadableError", "麦克风无法使用"],
  ])("explains %s and requires an explicit choice before entry", async (name, title) => {
    const error = new DOMException("browser detail", name);
    getUserMedia.mockRejectedValueOnce(error);
    rendered = await renderInAct(view());
    await click("进入会议");
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(title);
    expect(document.body.textContent).toContain("其他人暂时听不到你");
    expect(button("重新检测").disabled).toBe(false);
    expect(button("仍然进入（麦克风不可用）").disabled).toBe(false);
    expect(onJoin).not.toHaveBeenCalled();
    expect(onCheckError).toHaveBeenCalledWith(error);
    await click("仍然进入（麦克风不可用）");
    expect(onJoin).toHaveBeenCalledExactlyOnceWith(error);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("rechecks permission and joins automatically after recovery", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    rendered = await renderInAct(view());
    await click("进入会议");
    await click("重新检测");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
    expect(onJoin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("keeps the dialog open and locks both actions during a pending recheck", async () => {
    const pending = Promise.withResolvers<typeof stream>();
    getUserMedia.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    rendered = await renderInAct(view());
    await click("进入会议");
    getUserMedia.mockReturnValueOnce(pending.promise);
    await click("重新检测");
    expect(button("检测中…").disabled).toBe(true);
    expect(button("仍然进入（麦克风不可用）").disabled).toBe(true);
    await act(() => {
      button("检测中…").click();
      button("仍然进入（麦克风不可用）").click();
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      document.querySelector<HTMLElement>('[data-slot="alert-dialog-overlay"]')?.click();
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(onJoin).not.toHaveBeenCalled();
    await act(() => pending.reject(new DOMException("missing", "NotFoundError")));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("未检测到麦克风");
    expect(button("重新检测").disabled).toBe(false);
  });

  it("skips capture for observers", async () => {
    rendered = await renderInAct(
      <MeetingJoinButton
        disabled={false}
        isJoining={false}
        label="进入会议"
        preview={{ ...preview, interviewerName: "旁听人员", role: "observer" }}
        onJoin={onJoin}
        onCheckError={onCheckError}
      />,
    );
    await click("进入会议");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onJoin).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("offers explicit entry when browser capture is unsupported", async () => {
    Reflect.deleteProperty(navigator, "mediaDevices");
    rendered = await renderInAct(view());
    await click("进入会议");
    expect(document.body.textContent).toContain("当前环境无法使用麦克风");
    expect(onJoin).not.toHaveBeenCalled();
    await click("仍然进入（麦克风不可用）");
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it("does not enter or retain capture if unmounted while permission is pending", async () => {
    const pending = Promise.withResolvers<typeof stream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(view());
    await click("进入会议");
    await unmountInAct(rendered.root);
    rendered = undefined;
    await act(() => pending.resolve(stream));
    expect(stop).toHaveBeenCalledOnce();
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("respects blocked entry even when permission later succeeds", async () => {
    const pending = Promise.withResolvers<typeof stream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(view());
    await click("进入会议");
    await act(() => rendered?.root.render(view(true)));
    await act(() => pending.resolve(stream));
    expect(stop).toHaveBeenCalledOnce();
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("prevents microphone checks when meeting entry is blocked", async () => {
    rendered = await renderInAct(view(true));
    await click("进入会议");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("allows closing the warning without entering", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    rendered = await renderInAct(view());
    await click("进入会议");
    await waitForUi(() => expect(document.activeElement).toBe(button("重新检测")));
    await act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="关闭麦克风提示"]')?.click();
    });
    expect(onJoin).not.toHaveBeenCalled();
    expect(button("进入会议").disabled).toBe(false);
  });

  it.each([
    [[], "未检测到麦克风"],
    [[{ readyState: "ended" }], "麦克风无法使用"],
  ])("releases unusable captured tracks and reports the failure", async (tracks, title) => {
    getUserMedia.mockResolvedValueOnce({ ...stream, getAudioTracks: () => tracks });
    rendered = await renderInAct(view());
    await click("进入会议");
    expect(stop).toHaveBeenCalledOnce();
    expect(onJoin).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(title);
  });
});
