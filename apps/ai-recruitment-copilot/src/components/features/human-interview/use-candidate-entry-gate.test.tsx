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
  verify.mockReset().mockResolvedValue({ credentialRef: "K-test", proof: "signed-proof" });
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
  it("requires an explicit choice, carries proof to entry and reuses only the verified session", async () => {
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    expect(join).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    await click("使用已有凭据验证");
    expect(verify).toHaveBeenCalledExactlyOnceWith(
      "invite",
      "authenticate",
      traceHeaders(),
      expect.any(AbortSignal),
    );
    expect(join).toHaveBeenCalledWith(null, "signed-proof");
    await click("进入会议");
    expect(verify).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledTimes(2);
    await click("清除失效许可");
    await click("进入会议");
    expect(join).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("验证入场凭据");
  });
  it("never auto-registers after cancellation; explicit creation can be retried", async () => {
    verify.mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await click("使用已有凭据验证");
    expect(join).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("验证已取消或超时");
    expect(verify).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith("NotAllowedError");
    await click("首次使用，创建入场凭据");
    expect(verify.mock.calls[1][1]).toBe("register");
    expect(join).toHaveBeenCalledOnce();
  });
  it("recheck cannot bypass an active requirement but proceeds after an administrator disables it", async () => {
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await click("重新检查入会要求");
    expect(join).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("当前仍需验证或暂不可入会");
    recheck.mockResolvedValueOnce(true);
    await click("重新检查入会要求");
    expect(join.mock.calls).toEqual([[null, undefined]]);
    expect(verify).not.toHaveBeenCalled();
  });
  it("microphone force-entry still passes through the credential gate", async () => {
    const denied = new DOMException("Denied", "NotAllowedError");
    getUserMedia.mockRejectedValue(denied);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await click("仍然进入（麦克风不可用）");
    expect(join).not.toHaveBeenCalled();
    await click("使用已有凭据验证");
    expect(join).toHaveBeenCalledExactlyOnceWith(denied, "signed-proof");
  });
  it("blocks duplicate clicks and discards late results after cancellation", async () => {
    const pending = Promise.withResolvers<{ proof: string; credentialRef: string }>();
    verify.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await click("使用已有凭据验证");
    expect(button("首次使用，创建入场凭据").disabled).toBe(true);
    await click("使用已有凭据验证");
    expect(verify).toHaveBeenCalledOnce();
    await click("返回");
    expect(verify.mock.calls[0][3].aborted).toBe(true);
    await act(() => pending.resolve({ credentialRef: "K-late", proof: "late-proof" }));
    expect(join).not.toHaveBeenCalled();
    await click("进入会议");
    expect(join).not.toHaveBeenCalled();
  });
  it("cancels the ceremony on unmount", async () => {
    const pending = Promise.withResolvers<{ proof: string; credentialRef: string }>();
    verify.mockReturnValueOnce(pending.promise);
    rendered = await renderInAct(<Harness />);
    await click("进入会议");
    await click("使用已有凭据验证");
    await unmountInAct(rendered.root);
    rendered = undefined;
    expect(verify.mock.calls[0][3].aborted).toBe(true);
    await act(() => pending.resolve({ credentialRef: "K-late", proof: "late-proof" }));
    expect(join).not.toHaveBeenCalled();
  });
});
