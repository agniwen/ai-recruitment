// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { AdminMfaForm } from "./admin-mfa-form";
import { SecuritySettingsPage } from "./security-settings-page";
import { enrollMfa, fetchMfaStatus, replaceMfa, verifyMfaCode, verifyMfaReplacement } from "./api";

vi.mock("./api", () => ({
  enrollMfa: vi.fn(),
  fetchMfaStatus: vi.fn(),
  needsMfa: () => false,
  replaceMfa: vi.fn(),
  verifyMfaCode: vi.fn(),
  verifyMfaReplacement: vi.fn(),
}));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
const verified = {
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  recoveryCodes: [] as string[],
};

function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  act(() => button.click());
}
function enterCode(value: string) {
  const input = document.querySelector("input[autocomplete='one-time-code']");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!input || !setter) {
    throw new Error("Missing code input");
  }
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchMfaStatus).mockResolvedValue({
    enrolled: true,
    expiresAt: null,
  });
  vi.mocked(verifyMfaCode).mockResolvedValue(verified);
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  document.body.innerHTML = "";
});

describe("administrator MFA form", () => {
  it("resumes entry immediately when the server already has valid MFA but the page is stale", async () => {
    vi.mocked(fetchMfaStatus).mockResolvedValue({ enrolled: true, expiresAt: verified.expiresAt });
    const onVerified = vi.fn();
    rendered = await renderInAct(<AdminMfaForm onVerified={onVerified} />);
    await waitForUi(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(verifyMfaCode).not.toHaveBeenCalled();
    expect(enrollMfa).not.toHaveBeenCalled();
  });
  it("preserves leading zeroes and submits recovery codes only when explicitly selected", async () => {
    const onVerified = vi.fn();
    rendered = await renderInAct(<AdminMfaForm onVerified={onVerified} />);
    enterCode("012345");
    click("验证并继续");
    await waitForUi(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(verifyMfaCode).toHaveBeenLastCalledWith({ code: "012345", method: "totp" });
    click("使用恢复码");
    enterCode("a".repeat(32));
    click("验证并继续");
    await waitForUi(() => expect(onVerified).toHaveBeenCalledTimes(2));
    expect(verifyMfaCode).toHaveBeenLastCalledWith({ code: "a".repeat(32), method: "recovery" });
  });
  it("shows a local QR code and waits for recovery-code acknowledgement before entering the backend", async () => {
    vi.mocked(fetchMfaStatus).mockResolvedValue({
      enrolled: false,
      expiresAt: null,
    });
    vi.mocked(enrollMfa).mockResolvedValue({
      secret: "TESTONLYSECRET",
      uri: "otpauth://totp/test?secret=TESTONLYSECRET",
    });
    vi.mocked(verifyMfaCode).mockResolvedValue({ ...verified, recoveryCodes: ["b".repeat(32)] });
    const onVerified = vi.fn();
    rendered = await renderInAct(<AdminMfaForm onVerified={onVerified} />);
    expect(document.body.textContent).not.toContain("重新登录后绑定");
    await waitForUi(() =>
      expect(document.querySelector("svg title")?.textContent).toBe("身份验证器绑定二维码"),
    );
    enterCode("012345");
    click("验证并继续");
    await waitForUi(() => expect(document.body.textContent).toContain("b".repeat(32)));
    expect(onVerified).not.toHaveBeenCalled();
    click("继续");
    expect(onVerified).not.toHaveBeenCalled();
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) {
      throw new Error("Missing acknowledgement");
    }
    act(() => checkbox.click());
    click("继续");
    expect(onVerified).toHaveBeenCalledTimes(1);
  });
  it("does not resume an IP read when verification finishes after the form was closed", async () => {
    const verification = Promise.withResolvers<typeof verified>();
    vi.mocked(verifyMfaCode).mockReturnValue(verification.promise);
    const onVerified = vi.fn();
    rendered = await renderInAct(<AdminMfaForm onVerified={onVerified} />);
    enterCode("012345");
    click("验证并继续");
    expect(verifyMfaCode).toHaveBeenCalledTimes(1);
    await unmountInAct(rendered.root);
    rendered = undefined;
    await act(async () => {
      verification.resolve(verified);
      await Promise.resolve();
    });
    expect(onVerified).not.toHaveBeenCalled();
  });
  it("keeps recovery codes visible until the backend refresh finishes and shows callback failures", async () => {
    vi.mocked(fetchMfaStatus).mockResolvedValue({ enrolled: false, expiresAt: null });
    vi.mocked(enrollMfa).mockResolvedValue({
      secret: "TESTONLYSECRET",
      uri: "otpauth://totp/test?secret=TESTONLYSECRET",
    });
    vi.mocked(verifyMfaCode).mockResolvedValue({ ...verified, recoveryCodes: ["b".repeat(32)] });
    const refresh = Promise.withResolvers<undefined>();
    const onVerified = vi.fn().mockReturnValue(refresh.promise);
    rendered = await renderInAct(<AdminMfaForm onVerified={onVerified} />);
    await waitForUi(() => expect(document.querySelector("svg")).not.toBeNull());
    enterCode("012345");
    click("验证并继续");
    await waitForUi(() => expect(document.querySelector('input[type="checkbox"]')).not.toBeNull());
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) {
      throw new Error("Missing acknowledgement");
    }
    act(() => checkbox.click());
    click("继续");
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("正在进入后台…");
    expect(document.body.textContent).toContain("b".repeat(32));
    await act(async () => {
      refresh.reject(new Error("后台刷新失败"));
      await Promise.resolve();
    });
    await waitForUi(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toBe("后台刷新失败"),
    );
    expect(document.body.textContent).toContain("b".repeat(32));
  });
  it("uses replacement confirmation only for the new authenticator", async () => {
    vi.mocked(fetchMfaStatus).mockResolvedValue({ enrolled: true, expiresAt: verified.expiresAt });
    vi.mocked(replaceMfa).mockResolvedValue({
      secret: "NEWTESTSECRET",
      uri: "otpauth://totp/test?secret=NEWTESTSECRET",
    });
    vi.mocked(verifyMfaReplacement).mockResolvedValue({
      ...verified,
      recoveryCodes: ["c".repeat(32)],
    });
    const onVerified = vi.fn();
    rendered = await renderInAct(<AdminMfaForm purpose="replacement" onVerified={onVerified} />);
    await waitForUi(() => expect(document.body.textContent).toContain("NEWTESTSECRET"));
    enterCode("012345");
    click("验证并继续");
    await waitForUi(() => expect(document.body.textContent).toContain("c".repeat(32)));
    expect(verifyMfaReplacement).toHaveBeenCalledWith("012345");
    expect(verifyMfaCode).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
  });
  it("re-verifies expired backend access before preparing a replacement", async () => {
    vi.mocked(replaceMfa).mockResolvedValue({
      secret: "NEWTESTSECRET",
      uri: "otpauth://totp/test?secret=NEWTESTSECRET",
    });
    const onVerified = vi.fn();
    rendered = await renderInAct(<AdminMfaForm purpose="replacement" onVerified={onVerified} />);
    expect(replaceMfa).not.toHaveBeenCalled();
    enterCode("012345");
    click("验证并继续");
    await waitForUi(() => expect(document.body.textContent).toContain("NEWTESTSECRET"));
    expect(verifyMfaCode).toHaveBeenCalledWith({ code: "012345", method: "totp" });
    expect(verifyMfaReplacement).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
  });
  it("returns from replacement to the backend settings after recovery codes are acknowledged", async () => {
    vi.mocked(fetchMfaStatus).mockResolvedValue({ enrolled: true, expiresAt: verified.expiresAt });
    vi.mocked(replaceMfa).mockResolvedValue({
      secret: "NEWTESTSECRET",
      uri: "otpauth://totp/test?secret=NEWTESTSECRET",
    });
    vi.mocked(verifyMfaReplacement).mockResolvedValue({
      ...verified,
      recoveryCodes: ["c".repeat(32)],
    });
    rendered = await renderInAct(<SecuritySettingsPage />);
    click("更换验证器");
    await waitForUi(() => expect(document.body.textContent).toContain("NEWTESTSECRET"));
    enterCode("012345");
    click("验证并继续");
    await waitForUi(() => expect(document.body.textContent).toContain("c".repeat(32)));
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) {
      throw new Error("Missing acknowledgement");
    }
    act(() => checkbox.click());
    click("继续");
    await waitForUi(() => expect(document.body.textContent).toContain("更换验证器"));
    expect(document.body.textContent).not.toContain("c".repeat(32));
    expect(fetchMfaStatus).toHaveBeenCalledTimes(3);
  });
});
