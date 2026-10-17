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
  getOfferSscTelegramLink: vi.fn(),
  patchOfferDraftWithAttachment: vi.fn(),
  receiveOfferSscConfirmation: vi.fn(),
}));

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({
  completeOfferSscConfirmation: mocks.completeOfferSscConfirmation,
  getOfferSscTelegramLink: mocks.getOfferSscTelegramLink,
  offerApprovalAttachmentUrl: (_slug: string, _candidateId: string, draftId: string) =>
    `/offer-attachments/${draftId}`,
  patchOfferDraftWithAttachment: mocks.patchOfferDraftWithAttachment,
  receiveOfferSscConfirmation: mocks.receiveOfferSscConfirmation,
}));

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOfferSscTelegramLink.mockResolvedValue({ url: null });
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
  roots.push(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <OfferCard
          canDelete={false}
          canConfirm={options.canConfirm ?? false}
          canReceive={options.canReceive ?? false}
          canUpdate={canUpdate}
          candidateId="candidate-1"
          disabled={options.disabled ?? !canUpdate}
          draft={draft}
          onCancelled={vi.fn()}
          onDeleted={vi.fn()}
          onRespond={vi.fn()}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
  });
  return { host, onSaved };
}

describe("OfferCard approval attachment", () => {
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
  it.each([
    ["image/png", "ssc.png", true],
    ["application/octet-stream", "ssc.zip", false],
  ])(
    "offers actions on hover and previews %s in a modal",
    async (mediaType, filename, hasImage) => {
      vi.useFakeTimers();
      const { host } = renderCard(mediaType, filename);
      const link = host.querySelector<HTMLButtonElement>('button[aria-label^="附件操作"]');

      await act(async () => {
        const pointerEnter = new Event("pointerover", { bubbles: true });
        Object.defineProperty(pointerEnter, "pointerType", { value: "mouse" });
        link?.dispatchEvent(pointerEnter);
        link?.dispatchEvent(new MouseEvent("mouseenter"));
        vi.advanceTimersByTime(201);
        await Promise.resolve();
      });

      const actions = document.body.querySelector('[data-slot="hover-card-content"]');
      expect(actions?.textContent).toContain("查看");
      expect(actions?.querySelector("a[download]")?.getAttribute("href")).toBe(
        "/offer-attachments/offer-1",
      );
      expect(actions?.querySelector("img")).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => {
        actions?.querySelector<HTMLButtonElement>("button")?.click();
        await Promise.resolve();
      });
      const preview = document.body.querySelector('[role="dialog"]');
      expect(preview?.textContent).toContain(filename);
      expect(preview?.querySelector("img") !== null).toBe(hasImage);
      if (hasImage) {
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith("/offer-attachments/offer-1", {
          credentials: "include",
          signal: expect.any(AbortSignal),
        });
        expect(preview?.querySelector("img")?.getAttribute("src")).toBe("blob:offer-preview");
      } else {
        expect(fetch).not.toHaveBeenCalled();
      }
    },
  );

  it("edits the attachment after notes and removes it only on save", async () => {
    mocks.patchOfferDraftWithAttachment.mockResolvedValue({ id: "offer-1" });
    const { host, onSaved } = renderCard("image/png", "ssc.png", true);
    expect(document.body.querySelector('button[aria-label="删除审核附件：ssc.png"]')).toBeNull();

    act(() => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "编辑")
        ?.click();
    });

    const notes = host.querySelector("textarea");
    const attachmentInput = host.querySelector<HTMLInputElement>(
      "#offer-offer-1-approval-attachment",
    );
    expect(attachmentInput).not.toBeNull();
    expect(
      notes &&
        attachmentInput &&
        // oxlint-disable-next-line no-bitwise -- compareDocumentPosition returns a DOM bitmask.
        notes.compareDocumentPosition(attachmentInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(host.textContent).toContain("当前附件：ssc.png");
    expect(host.querySelector("img")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="删除审核附件：ssc.png"]')?.click();
    });
    expect(mocks.patchOfferDraftWithAttachment).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("撤销删除");

    const save = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "保存",
    );
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });

    expect(mocks.patchOfferDraftWithAttachment).toHaveBeenCalledWith(
      "demo",
      "candidate-1",
      "offer-1",
      expect.objectContaining({ position: "工程师" }),
      null,
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("replaces the current attachment from the edit form", async () => {
    mocks.patchOfferDraftWithAttachment.mockResolvedValue({ id: "offer-1" });
    const { host } = renderCard("image/png", "old.png", true);
    act(() => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "编辑")
        ?.click();
    });
    const input = host.querySelector<HTMLInputElement>("#offer-offer-1-approval-attachment");
    const replacement = new File(["new"], "new.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [replacement] });
    act(() => input?.dispatchEvent(new Event("change", { bubbles: true })));

    expect(host.textContent).toContain("已选择：new.png");
    expect(host.textContent).not.toContain("当前附件：old.png");
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "保存")
        ?.click();
      await Promise.resolve();
    });
    expect(mocks.patchOfferDraftWithAttachment).toHaveBeenCalledWith(
      "demo",
      "candidate-1",
      "offer-1",
      expect.objectContaining({ position: "工程师" }),
      replacement,
    );
  });
});

function findButton(host: HTMLElement, label: string) {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

async function flushMutation() {
  await act(async () => {
    await delay(0);
    await delay(0);
  });
}

describe("OfferCard SSC confirmation", () => {
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
    ["pending", true, false, "SSC接收确认"],
    ["pending", false, true, null],
    ["confirming", true, false, null],
    ["confirming", false, true, "SSC完成确认"],
    ["completed", true, true, null],
    [null, true, true, null],
  ] as const)(
    "gates %s actions by their dedicated permission",
    async (status, canReceive, canConfirm, label) => {
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
      expect(sscButtons.map((button) => button.textContent?.trim())).toEqual(label ? [label] : []);
      expect(findButton(host, "编辑")).toBeUndefined();
    },
  );

  it.each(["pending", "confirming"] as const)(
    "explains why %s cannot be sent or hired",
    (status) => {
      const { host } = renderCard("image/png", "ssc.png", true, "CNY", {
        draft: { sscConfirmationStatus: status },
      });
      expect(host.textContent).toContain("SSC完成确认后方可发送 Offer 或标记入职");
    },
  );

  it.each([
    ["pending", "SSC接收确认", "接收中…", "receiveOfferSscConfirmation"],
    ["confirming", "SSC完成确认", "确认中…", "completeOfferSscConfirmation"],
  ] as const)(
    "submits %s with the displayed revision and disables actions until refreshed",
    async (status, label, pendingLabel, api) => {
      const pending = Promise.withResolvers<null>();
      mocks[api].mockReturnValue(pending.promise);
      const { host, onSaved } = renderCard("image/png", "ssc.png", true, "CNY", {
        canConfirm: true,
        canReceive: true,
        draft: { sscConfirmationStatus: status },
      });
      const button = findButton(host, label);
      expect(button).toBeDefined();
      await act(() => {
        button?.click();
      });
      await flushMutation();
      expect(mocks[api]).toHaveBeenCalledExactlyOnceWith("demo", "candidate-1", "offer-1", {
        revision: 3,
      });
      expect(findButton(host, pendingLabel)?.disabled).toBe(true);
      expect(findButton(host, "编辑")?.disabled).toBe(true);
      expect(onSaved).not.toHaveBeenCalled();
      await act(() => {
        pending.resolve(null);
      });
      await flushMutation();
      expect(onSaved).toHaveBeenCalledOnce();
    },
  );

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
