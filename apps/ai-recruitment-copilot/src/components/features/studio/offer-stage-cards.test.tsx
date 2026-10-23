// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { OfferCard } from "./offer-stage-cards";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  completeOfferSscConfirmation: vi.fn(),
  confirmOfferPreboardingDate: vi.fn(),
  getOfferRecruiterContact: vi.fn(),
  getOfferSscTelegramLink: vi.fn(),
  patchOfferDraft: vi.fn(),
  patchOfferDraftWithAttachment: vi.fn(),
  receiveOfferSscConfirmation: vi.fn(),
}));

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({
  completeOfferSscConfirmation: mocks.completeOfferSscConfirmation,
  confirmOfferPreboardingDate: mocks.confirmOfferPreboardingDate,
  getOfferRecruiterContact: mocks.getOfferRecruiterContact,
  getOfferSscTelegramLink: mocks.getOfferSscTelegramLink,
  offerApprovalAttachmentUrl: (_slug: string, _candidateId: string, draftId: string) =>
    `/offer-attachments/${draftId}`,
  offerSscCompletionAttachmentUrl: (_slug: string, _candidateId: string, draftId: string) =>
    `/offer-completion-attachments/${draftId}`,
  patchOfferDraft: mocks.patchOfferDraft,
  patchOfferDraftWithAttachment: mocks.patchOfferDraftWithAttachment,
  receiveOfferSscConfirmation: mocks.receiveOfferSscConfirmation,
}));

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOfferSscTelegramLink.mockResolvedValue({ url: null });
  mocks.getOfferRecruiterContact.mockResolvedValue({ canConfirm: false, status: "pending" });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(["image"], { type: "image/png" })),
      ok: true,
    }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:offer-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function renderCard(
  mediaType: string,
  filename: string,
  canUpdate = false,
  currency = "CNY",
  options: {
    canConfirm?: boolean;
    canReceive?: boolean;
    disabled?: boolean;
    draft?: Partial<OfferDraftRecord>;
  } = {},
) {
  const onSaved = vi.fn();
  const draft: OfferDraftRecord = {
    approvalAttachment: { filename, mediaType, size: 3 },
    baseSalary: 30_000,
    bonus: null,
    candidateCounter: null,
    createdAt: "2026-09-23T00:00:00.000Z",
    currency,
    equity: null,
    expiresAt: null,
    id: "offer-1",
    interviewRecordId: "candidate-1",
    joiningDate: null,
    notes: null,
    organizationId: "org-1",
    position: "工程师",
    preboardingDate: "2026-11-02",
    responseAt: null,
    sentAt: null,
    sscCompletedAt: null,
    sscCompletedBy: null,
    sscConfirmationStatus: null,
    sscReceivedAt: null,
    sscReceivedBy: null,
    sscRevision: 3,
    status: "draft",
    updatedAt: "2026-09-23T00:00:00.000Z",
    version: 1,
    ...options.draft,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient();
  roots.push(root);
  function rerender(nextOptions: typeof options = options) {
    const current = { ...options, ...nextOptions };
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OfferCard
            canDelete={false}
            canConfirm={current.canConfirm ?? false}
            canReceive={current.canReceive ?? false}
            canUpdate={canUpdate}
            candidateId="candidate-1"
            disabled={current.disabled ?? !canUpdate}
            draft={{ ...draft, ...current.draft }}
            onCancelled={vi.fn()}
            onDeleted={vi.fn()}
            onRespond={vi.fn()}
            onSaved={onSaved}
          />
        </QueryClientProvider>,
      );
    });
  }
  rerender();
  return { host, onSaved, rerender };
}

function findButton(host: HTMLElement, label: string) {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

describe("OfferCard approval attachment", () => {
  it("shows the SSC preboarding date separately from the ODC expected joining date", () => {
    const { host } = renderCard("application/pdf", "approval.pdf", false, "CNY", {
      draft: { joiningDate: "2026-11-02", preboardingDate: "2026-11-05" },
    });
    expect(host.textContent).toContain("期望上岗日期");
    expect(host.textContent).toContain("预入职日期");
    expect(host.textContent).toContain("2026-11-05");
    expect(host.textContent).toContain("2026-11-02");
  });

  it.each([
    ["CNY", "¥", "人民币 CNY"],
    ["USD", "$", "美元 USD"],
    ["GBP", "£", "英镑 GBP"],
  ])("preserves %s when displaying and editing the offer salary", (currency, symbol, label) => {
    const { host } = renderCard("image/png", "ssc.png", true, currency);
    expect(host.textContent).toContain(`${symbol} 30,000`);
    act(() => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "编辑")
        ?.click();
    });
    expect(host.querySelector('[id$="-currency"]')?.textContent).toContain(label);
  });
  it.each(["image/png", "application/octet-stream"])(
    "hides historical ODC attachment controls and links: %s",
    (mediaType) => {
      const { host } = renderCard(mediaType, "old-odc-approval.png");
      expect(host.querySelector('[aria-label^="附件操作"]')).toBeNull();
      expect(host.querySelector('a[href*="offer-attachments"]')).toBeNull();
      expect(host.textContent).not.toContain("old-odc-approval.png");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("edits offer terms as JSON without file controls or screenshot paste", async () => {
    mocks.patchOfferDraft.mockResolvedValue({ id: "offer-1" });
    const { host, onSaved } = renderCard("image/png", "old-odc-approval.png", true, "CNY", {
      draft: {
        confirmationInfo: {
          candidateCode: null,
          candidateName: "候选人甲",
          departmentName: "平台部",
          directManager: "上级甲",
          gender: "女",
          hiringUnitName: "研发中心",
          interviewFeedback: null,
          interviewRoundId: null,
          jobLevel: "P3",
          jobType: "技术",
          mainInterviewerName: null,
          managementSequence: "个人",
          personnelType: "直属",
          probationPeriod: "2个月",
          probationSalary: 25_000,
          serviceUnit: "研发服务单位",
          workLocation: "中国",
          workMode: "远程",
        },
        joiningDate: "2026-12-01",
      },
    });
    await act(() => findButton(host, "编辑")?.click());
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(host.querySelector('[aria-label^="附件操作"]')).toBeNull();
    expect(host.textContent).not.toContain("old-odc-approval.png");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [new File(["image"], "pasted.png", { type: "image/png" })] },
    });
    act(() => host.querySelector("textarea")?.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(false);
    expect(host.textContent).not.toContain("pasted.png");
    const gender = host.querySelector<HTMLSelectElement>("#offer-offer-1-confirm-gender");
    function setGender(value: string) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
          gender,
          value,
        );
        gender?.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    setGender("");
    await act(() => findButton(host, "保存")?.click());
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("性别");
      expect(gender?.getAttribute("aria-invalid")).toBe("true");
    });
    expect(mocks.patchOfferDraft).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(gender);
    setGender("女");
    await act(() => findButton(host, "保存")?.click());
    await vi.waitFor(async () => {
      await act(() => Promise.resolve());
      expect(onSaved).toHaveBeenCalledOnce();
    });
    expect(mocks.patchOfferDraft).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      "offer-1",
      expect.objectContaining({ position: "工程师" }),
    );
    expect(mocks.patchOfferDraftWithAttachment).not.toHaveBeenCalled();
  });
});

async function flushMutation() {
  await act(async () => {
    await delay(0);
    await delay(0);
  });
}

describe("OfferCard SSC confirmation", () => {
  it("withholds SSC actions and Telegram entry until the recruiter confirms the private TG", async () => {
    mocks.getOfferSscTelegramLink.mockResolvedValue({
      url: "https://t.me/recruiting_bot?start=offer_offer-1",
    });
    const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
      canConfirm: true,
      canReceive: true,
      disabled: false,
      draft: { recruiterConfirmationStatus: "pending", sscConfirmationStatus: "pending" },
    });
    await flushMutation();
    expect(host.textContent).toContain("待招聘人员确认私人 TG");
    expect(findButton(host, "SSC接收确认")).toBeUndefined();
    expect(findButton(host, "SSC完成确认")).toBeUndefined();
    expect(host.textContent).not.toContain("在 Telegram 中确认");
    expect(mocks.getOfferSscTelegramLink).not.toHaveBeenCalled();
  });

  it.each([
    { canReceive: true, status: "completed" },
    { canReceive: false, status: "pending" },
  ] as const)(
    "hides a cached Telegram link after eligibility changes to $status, receive=$canReceive",
    async ({ canReceive, status }) => {
      const url = "https://t.me/recruiting_bot?start=offer_offer-1";
      mocks.getOfferSscTelegramLink.mockResolvedValue({ url });
      const { host, rerender } = renderCard("image/png", "ssc.png", false, "CNY", {
        canReceive: true,
        disabled: false,
        draft: { sscConfirmationStatus: "pending" },
      });
      await flushMutation();
      expect(host.querySelector(`a[href="${url}"]`)).not.toBeNull();
      rerender({ canReceive, draft: { sscConfirmationStatus: status } });
      await flushMutation();
      expect(host.querySelector(`a[href="${url}"]`)).toBeNull();
      expect(host.textContent).not.toContain("在 Telegram 中确认");
    },
  );
  it("shows the SSC workflow state instead of draft for a completed new offer", () => {
    const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
      draft: { sscConfirmationStatus: "completed" },
    });
    expect(host.textContent).toContain("已完成确认");
    expect(host.textContent).not.toContain("草稿");
  });
  it.each(["https://t.me/recruiting_bot?start=offer_offer-1", null])(
    "shows only an available Telegram confirmation link: %s",
    async (url) => {
      mocks.getOfferSscTelegramLink.mockResolvedValue({ url });
      const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
        canReceive: true,
        disabled: false,
        draft: { sscConfirmationStatus: "pending" },
      });
      await flushMutation();
      const link = [...host.querySelectorAll("a")].find((item) =>
        item.textContent?.includes("Telegram"),
      );
      expect(link?.getAttribute("href") ?? null).toBe(url);
      if (url) {
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toContain("noopener");
      }
    },
  );
  it.each([
    ["pending", "Offer新增"],
    ["confirming", "确认中"],
    ["completed", "已完成确认"],
  ] as const)("shows %s independently from candidate acceptance", (status, label) => {
    const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
      draft: { sscConfirmationStatus: status, status: "accepted" },
    });
    expect(host.textContent).toContain(label);
    expect(host.textContent).toContain("已接受");
  });

  it.each([
    ["pending", true, false, true, false],
    ["pending", false, true, false, false],
    ["confirming", true, false, false, false],
    ["confirming", false, true, false, true],
    ["completed", true, true, false, false],
    [null, true, true, false, false],
  ] as const)(
    "gates %s actions by their dedicated permission",
    async (status, canReceive, canConfirm, receiveEnabled, confirmEnabled) => {
      const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
        canConfirm,
        canReceive,
        disabled: false,
        draft: { sscConfirmationStatus: status },
      });
      await flushMutation();
      const sscButtons = [...host.querySelectorAll("button")].filter((button) =>
        button.textContent?.includes("SSC"),
      );
      if (status === "pending" || status === "confirming") {
        expect(sscButtons.map((button) => button.textContent?.trim())).toEqual([
          "SSC接收确认",
          "SSC完成确认",
        ]);
        expect(findButton(host, "SSC接收确认")?.disabled).toBe(!receiveEnabled);
        expect(findButton(host, "SSC完成确认")?.disabled).toBe(!confirmEnabled);
      } else {
        expect(sscButtons).toHaveLength(0);
      }
      expect(findButton(host, "编辑")).toBeUndefined();
    },
  );

  it.each(["pending", "confirming"] as const)(
    "explains both missing SSC permissions for %s",
    async (status) => {
      const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
        disabled: false,
        draft: { sscConfirmationStatus: status },
      });
      await flushMutation();
      expect(findButton(host, "SSC接收确认")?.disabled).toBe(true);
      expect(findButton(host, "SSC完成确认")?.disabled).toBe(true);
      expect(host.textContent).toContain("当前账号无SSC接收确认权限");
      expect(host.textContent).toContain("当前账号无SSC完成确认权限");
    },
  );

  it.each(["deleted", "superseded"] as const)(
    "offers no SSC actions for a %s version",
    async (status) => {
      const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
        canConfirm: true,
        canReceive: true,
        disabled: false,
        draft: { sscConfirmationStatus: "pending", status },
      });
      await flushMutation();
      expect(findButton(host, "SSC接收确认")).toBeUndefined();
      expect(findButton(host, "SSC完成确认")).toBeUndefined();
    },
  );

  it("offers no SSC actions for a closed candidate", async () => {
    const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
      canConfirm: true,
      canReceive: true,
      disabled: true,
      draft: { sscConfirmationStatus: "pending" },
    });
    await flushMutation();
    expect(findButton(host, "SSC接收确认")).toBeUndefined();
    expect(findButton(host, "SSC完成确认")).toBeUndefined();
  });

  it.each(["pending", "confirming"] as const)(
    "explains why %s cannot be sent or hired",
    (status) => {
      const { host } = renderCard("image/png", "ssc.png", true, "CNY", {
        draft: { sscConfirmationStatus: status },
      });
      expect(host.textContent).toContain("SSC完成确认后方可发送 Offer 或标记入职");
    },
  );

  it("receives the displayed revision and disables actions until refreshed", async () => {
    const pending = Promise.withResolvers<null>();
    mocks.receiveOfferSscConfirmation.mockReturnValue(pending.promise);
    const { host, onSaved } = renderCard("image/png", "ssc.png", true, "CNY", {
      canConfirm: true,
      canReceive: true,
      draft: { sscConfirmationStatus: "pending" },
    });
    const button = findButton(host, "SSC接收确认");
    expect(button).toBeDefined();
    await act(() => {
      button?.click();
    });
    await flushMutation();
    expect(mocks.receiveOfferSscConfirmation).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      "offer-1",
      {
        revision: 3,
      },
    );
    expect(findButton(host, "接收中…")?.disabled).toBe(true);
    expect(findButton(host, "编辑")?.disabled).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    await act(() => {
      pending.resolve(null);
    });
    await flushMutation();
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("opens an internal approval question before completing the offer", async () => {
    const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
      canConfirm: true,
      disabled: false,
      draft: { sscConfirmationStatus: "confirming" },
    });
    await act(() => findButton(host, "SSC完成确认")?.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      "是否已经完成内部审批",
    );
    expect(mocks.completeOfferSscConfirmation).not.toHaveBeenCalled();
  });

  it.each([3, 2])("shows completion proof only for the current revision: %s", async (revision) => {
    const { host } = renderCard("image/png", "ssc.png", false, "CNY", {
      draft: {
        sscCompletionAttachment: {
          filename: "approval.png",
          mediaType: "image/png",
          revision,
          size: 8,
        },
        sscConfirmationStatus: "completed",
      },
    });
    expect(host.querySelector('[aria-label="附件操作：ssc.png"]')).toBeNull();
    const proof = host.querySelector('[aria-label="附件操作：approval.png"]');
    if (revision === 3) {
      expect(proof).not.toBeNull();
      expect(host.textContent).toContain("内部审批截图");
      expect(fetch).not.toHaveBeenCalled();
      await act(() => (proof as HTMLButtonElement | null)?.click());
      expect(document.body.querySelector('a[download="approval.png"]')?.getAttribute("href")).toBe(
        "/offer-completion-attachments/offer-1",
      );
      await act(() => findButton(document.body, "查看")?.click());
      await vi.waitFor(async () => {
        await act(() => Promise.resolve());
        expect(
          document.body.querySelector('img[alt="内部审批截图：approval.png"]')?.getAttribute("src"),
        ).toBe("blob:offer-preview");
      });
      expect(fetch).toHaveBeenCalledWith("/offer-completion-attachments/offer-1", {
        credentials: "include",
        signal: expect.any(AbortSignal),
      });
    } else {
      expect(proof).toBeNull();
    }
  });

  it("keeps the failed action available and shows a stale-revision error", async () => {
    mocks.receiveOfferSscConfirmation.mockRejectedValue(new Error("Offer 已更新，请刷新后重试"));
    const { host, onSaved } = renderCard("image/png", "ssc.png", false, "CNY", {
      canReceive: true,
      disabled: false,
      draft: { sscConfirmationStatus: "pending" },
    });
    const button = findButton(host, "SSC接收确认");
    expect(button).toBeDefined();
    await act(() => {
      button?.click();
    });
    await flushMutation();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Offer 已更新，请刷新后重试",
    );
    expect(findButton(host, "SSC接收确认")?.disabled).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
