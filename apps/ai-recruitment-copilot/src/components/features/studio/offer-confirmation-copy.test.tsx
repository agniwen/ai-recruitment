// @vitest-environment jsdom

import type { OfferConfirmationDetails } from "@arc/shared/offer-confirmation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfferConfirmationText } from "./offer-creation-confirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("@/lib/client/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo, success: mocks.toastSuccess },
}));

const confirmationInfo = {
  candidateCode: "EMP-SAVED",
  candidateName: "候选人甲",
  departmentName: "平台部",
  directManager: null,
  gender: "女",
  hiringUnitName: "研发中心",
  interviewFeedback: "已保存的面试评价",
  interviewRoundId: null,
  jobLevel: "P6",
  jobType: null,
  mainInterviewerName: null,
  managementSequence: null,
  personnelType: null,
  probationPeriod: null,
  probationSalary: null,
  serviceUnit: "研发服务单位",
  workLocation: "上海",
  workMode: null,
} satisfies OfferConfirmationDetails;

const confirmationProps = {
  baseSalary: 30_000,
  candidateRecordId: "candidate-1",
  currency: "CNY",
  info: confirmationInfo,
  position: "平台工程师",
  sscConfirmationStatus: "completed",
} satisfies Parameters<typeof OfferConfirmationText>[0];

const savedConfirmationText = `【offer信息】
候选人编码：EMP-SAVED
系统记录编码：candidate-1
简历名：候选人甲
性别：女

1️⃣编制信息：
入职编制组织：研发中心
入职服务单位：研发服务单位
人员性质：待补充
入职部门：平台部
直属上级：待补充
岗位类型：待补充
职位：平台工程师
建议职级：P6
管理序列：待补充
办公方式：待补充
办公地区：上海

2️⃣薪资信息
薪资货币：CNY
转正薪资：30K
试用期：待补充
试用薪资：待补充

#面试评价：
主要面试官：待补充
面试评价：已保存的面试评价

offer审批已通过`;

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copy.mockReset().mockResolvedValue("copied");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
});

function renderConfirmation() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onSubmit = vi.fn();
  function render(props: Parameters<typeof OfferConfirmationText>[0] = confirmationProps) {
    act(() =>
      root.render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <OfferConfirmationText {...props} />
        </form>,
      ),
    );
  }
  render();
  return { host, onSubmit, render };
}

function copyButton(host: HTMLElement) {
  const target = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === "复制 Offer 信息",
  );
  if (!target) {
    throw new Error("missing complete Offer copy button");
  }
  return target;
}

describe("copying complete Offer confirmation information", () => {
  it("copies the entire displayed multiline template with salary, system code and current SSC status", async () => {
    const { host, onSubmit, render } = renderConfirmation();
    expect(host.querySelector("pre")?.textContent).toBe(savedConfirmationText);
    expect(savedConfirmationText.length).toBeGreaterThan(256);
    await act(() => copyButton(host).click());
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(savedConfirmationText, expect.any(Function));
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();

    render({
      ...confirmationProps,
      baseSalary: 35_000,
      info: { ...confirmationInfo, candidateCode: "EMP-UPDATED" },
      sscConfirmationStatus: "confirming",
    });
    await act(() => copyButton(host).click());
    expect(mocks.copy).toHaveBeenLastCalledWith(
      savedConfirmationText
        .replace("EMP-SAVED", "EMP-UPDATED")
        .replace("转正薪资：30K", "转正薪资：35K")
        .replace("offer审批已通过", "SSC 确认中"),
      expect.any(Function),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prevents repeated copies while the clipboard operation is pending", async () => {
    const pending = Promise.withResolvers<"copied">();
    mocks.copy.mockReturnValueOnce(pending.promise);
    const { host } = renderConfirmation();
    const target = copyButton(host);
    await act(() => {
      target.click();
      target.click();
    });
    expect(mocks.copy).toHaveBeenCalledOnce();
    expect(target.disabled).toBe(true);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    await act(() => pending.resolve("copied"));
    expect(copyButton(host).disabled).toBe(false);
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
  });

  it("offers manual copying without reporting clipboard success when the fallback is used or dismissed", async () => {
    mocks.copy.mockImplementationOnce((text: string, manualFallback: (value: string) => void) => {
      manualFallback(text);
      return Promise.resolve("manual");
    });
    const { host, onSubmit } = renderConfirmation();
    await act(() => copyButton(host).click());
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(savedConfirmationText, expect.any(Function));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledOnce();
    expect(copyButton(host).disabled).toBe(false);
    const dialog = document.querySelector('[role="dialog"]');
    const textarea = dialog?.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="完整 Offer 信息"]',
    );
    expect(textarea?.readOnly).toBe(true);
    expect(textarea?.value).toBe(savedConfirmationText);
    expect(textarea?.value.split("\n")).toEqual(savedConfirmationText.split("\n"));
    const selectAll = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (node) => node.textContent?.trim() === "全选内容",
    );
    expect(selectAll).toBeDefined();
    await act(() => selectAll?.click());
    expect(document.activeElement).toBe(textarea);
    expect(textarea?.selectionStart).toBe(0);
    expect(textarea?.selectionEnd).toBe(savedConfirmationText.length);
    const close = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (node) => node.textContent?.trim() === "关闭",
    );
    expect(close).toBeDefined();
    await act(() => close?.click());
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["failed", "rejected"])(
    "reports %s copying without success and allows retry",
    async (result) => {
      if (result === "rejected") {
        mocks.copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
      } else {
        mocks.copy.mockResolvedValueOnce(result);
      }
      const { host } = renderConfirmation();
      await act(() => copyButton(host).click());
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledOnce();
      expect(copyButton(host).disabled).toBe(false);
      await act(() => copyButton(host).click());
      expect(mocks.copy).toHaveBeenCalledTimes(2);
      expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    },
  );
});
