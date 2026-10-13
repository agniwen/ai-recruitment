// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInAct, unmountInAct, enableReactActEnvironment } from "@/test-utils/react-act";
import { useCandidateEntryGate } from "./use-candidate-entry-gate";
import { MeetingJoinButton } from "./human-meeting-join-button";
import type * as CredentialApi from "./entry-credential-api";
import { verifyCandidateCredential } from "./entry-credential-api";

vi.mock("./entry-credential-api", async (original) => ({
  ...(await original<typeof CredentialApi>()),
  verifyCandidateCredential: vi.fn(),
}));
enableReactActEnvironment();
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
const verify = vi.mocked(verifyCandidateCredential);
const registration = (createdCount = 0) => ({
  canCreate: createdCount < 2,
  createdCount,
  limit: 2,
});
const verified = (createdCount = 0) => ({
  credentialRef: "K-test",
  proof: "signed-proof",
  registration: registration(createdCount),
});
function rejectOnce(error: Error, createdCount = 0) {
  verify.mockImplementationOnce((...args) => {
    args[4]?.(registration(createdCount));
    return Promise.reject(error);
  });
}
const join = vi.fn();
const recheck = vi.fn();
const failure = vi.fn();
const getUserMedia = vi.fn();
const traceHeaders = () => ({ "x-interview-visit-id": "visit" });
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
function Harness({ required = true }: { required?: boolean }) {
  const gate = useCandidateEntryGate({
    headers: traceHeaders,
    inviteToken: "invite",
    join,
    onFailure: failure,
    recheck,
    required,
  });
  return (
    <>
      <MeetingJoinButton
        disabled={false}
        isJoining={false}
        label="进入会议"
        preview={{
          candidateName: "候选人",
          entryAccess: { canJoin: true, reason: null, recheckAfterMs: null },
          meetingId: "meeting",
          roundLabel: "初试",
          scheduledAt: null,
          status: "in_progress",
          title: "面试",
          validUntil: null,
        }}
        onJoin={gate.beginJoin}
        onCheckError={() => {}}
      />
      <button type="button" onClick={() => gate.requireCredential(null)}>
        清除失效许可
      </button>
      {gate.dialog}
    </>
  );
}
function button(label: string) {
  const node = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!node) {
    throw new Error(`Missing button ${label}`);
  }
  return node;
}
async function click(label: string) {
  await act(() => button(label).click());
}
beforeEach(() => {
  verify.mockReset().mockImplementation((...args) => {
    const result = verified();
    args[4]?.(result.registration);
    return Promise.resolve(result);
  });
  join.mockReset().mockResolvedValue(null);
  recheck.mockReset().mockResolvedValue(false);
  failure.mockReset();
  getUserMedia.mockReset().mockResolvedValue({
    getAudioTracks: () => [{ readyState: "live" }],
    getTracks: () => [{ stop() {} }],
  });
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

describe("candidate entry gate", () => {
  it("retains normal entry without any credential operation when disabled", async () => {
    rendered = await renderInAct(<Harness required={false} />);
    await click("进入会议");
    expect(join.mock.calls).toEqual([[null, undefined]]);
    expect(verify).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("验证入场凭据");
  });
  it("authenticates on entry without a prior choice and reuses only the verified session", async () => {
    rendered = await renderInAct(<Harness />);
    expect(verify).not.toHaveBeenCalled();
    await click("进入会议");
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0].slice(0, 4)).toEqual([
      "invite",
      "authenticate",
      traceHeaders(),
      expect.any(AbortSignal),
    ]);
    expect(join).toHaveBeenCalledWith(null, "signed-proof");
    await click("进入会议");
    expect(verify).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledTimes(2);
    await click("清除失效许可");
    await click("进入会议");
    expect(join).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("验证入场凭据");
    await click("创建凭证进入面试");
    expect(verify.mock.calls[1][1]).toBe("register");
    expect(join).toHaveBeenCalledTimes(3);
  });
  it.each([0, 1])(
    "offers creation without the count hint, and retry only above zero when %i credentials exist",
    async (count) => {
      rejectOnce(new DOMException("Cancelled", "NotAllowedError"), count);
      rendered = await renderInAct(<Harness />);
      await click("进入会议");
      expect(join).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("验证已取消或超时");
      expect(verify).toHaveBeenCalledOnce();
      expect(failure).toHaveBeenCalledWith("NotAllowedError");
      expect(document.body.textContent).not.toContain("本场面试已创建");
      expect(document.body.textContent).not.toContain("已达到创建上限");
      expect(
        [...document.querySelectorAll("button")].some((item) => item.textContent === "重新验证"),
      ).toBe(count > 0);
      if (count > 0) {
        rejectOnce(new DOMException("Cancelled", "NotAllowedError"), count);
        await click("重新验证");
        expect(verify.mock.calls.at(-1)?.[1]).toBe("authenticate");
      }
      await click("创建凭证进入面试");
      expect(verify.mock.calls.at(-1)?.[1]).toBe("register");
      expect(join).toHaveBeenCalledOnce();
    },
  );
  it.each([2, 3])(
    "hides creation for %i registrations while retaining retry and HR recheck",
    async (count) => {
      rejectOnce(new DOMException("Cancelled", "NotAllowedError"), count);
      rendered = await renderInAct(<Harness />);
      await click("进入会议");
      expect(document.body.textContent).toContain("入场凭据已达到创建上限");
      expect(document.body.textContent).not.toMatch(/\d/);
      expect(document.body.textContent).not.toContain("创建凭证进入面试");
      expect(button("重新验证")).toBeDefined();
      expect(button("重新检查入会要求")).toBeDefined();
      await click("重新验证");
      expect(verify.mock.calls[1][1]).toBe("authenticate");
      expect(join).toHaveBeenCalledOnce();
    },
  );
  it("updates the button after the second successful registration", async () => {
    rejectOnce(new DOMException("Cancelled", "NotAllowedError"), 1);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    expect(document.body.textContent).not.toContain("已达到创建上限");
    verify.mockImplementationOnce((...args) => {
      args[4]?.(registration(2));
      return Promise.resolve(verified(2));
    });
    await click("创建凭证进入面试");
    await click("清除失效许可");
    expect(document.body.textContent).toContain("入场凭据已达到创建上限");
    expect(document.body.textContent).not.toMatch(/\d/);
    expect(document.body.textContent).not.toContain("创建凭证进入面试");
  });
  it("recheck cannot bypass an active requirement but proceeds after an administrator disables it", async () => {
    rejectOnce(new DOMException("Cancelled", "NotAllowedError"));
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await click("重新检查入会要求");
    expect(join).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("当前仍需验证或暂不可入会");
    recheck.mockResolvedValueOnce(true);
    await click("重新检查入会要求");
    expect(join.mock.calls).toEqual([[null, undefined]]);
    expect(verify).toHaveBeenCalledOnce();
  });
  it("microphone force-entry still passes through the credential gate", async () => {
    const denied = new DOMException("Denied", "NotAllowedError");
    getUserMedia.mockRejectedValue(denied);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    expect(verify).not.toHaveBeenCalled();
    await click("仍然进入（麦克风不可用）");
    expect(verify.mock.calls[0][1]).toBe("authenticate");
    expect(join).toHaveBeenCalledExactlyOnceWith(denied, "signed-proof");
  });
  it("blocks duplicate clicks and discards late results after cancellation", async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof verifyCandidateCredential>>>();
    verify.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    expect(document.body.textContent).not.toContain("创建凭证进入面试");
    expect(document.querySelector("output")?.textContent).toContain("正在验证");
    await click("进入会议");
    expect(verify).toHaveBeenCalledOnce();
    await click("返回");
    expect(verify.mock.calls[0][3].aborted).toBe(true);
    await act(() =>
      pending.resolve({ ...verified(), credentialRef: "K-late", proof: "late-proof" }),
    );
    expect(join).not.toHaveBeenCalled();
    await click("进入会议");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(join).toHaveBeenCalledExactlyOnceWith(null, "signed-proof");
  });
  it("cancels the ceremony on unmount", async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof verifyCandidateCredential>>>();
    verify.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await unmountInAct(rendered.root);
    rendered = undefined;
    expect(verify.mock.calls[0][3].aborted).toBe(true);
    await act(() =>
      pending.resolve({ ...verified(), credentialRef: "K-late", proof: "late-proof" }),
    );
    expect(join).not.toHaveBeenCalled();
  });
  it("does not show temporary debug controls", async () => {
    rejectOnce(new DOMException("Cancelled", "NotAllowedError"));
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    expect(document.body.textContent).not.toContain("下载调试日志");
    expect(document.body.textContent).not.toContain("记录备注");
  });
});
