// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { OfferSscActions, useOfferSscConfirmation } from "./offer-ssc-confirmation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  telegramLink: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  completeOfferSscConfirmation: mocks.complete,
  getOfferSscTelegramLink: mocks.telegramLink,
  receiveOfferSscConfirmation: vi.fn(),
}));

const roots: ReturnType<typeof createRoot>[] = [];

function createDraft(overrides: Partial<OfferDraftRecord> = {}): OfferDraftRecord {
  return {
    approvalAttachment: null,
    baseSalary: 30_000,
    bonus: null,
    candidateCounter: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    currency: "CNY",
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
    sscConfirmationStatus: "confirming",
    sscReceivedAt: "2026-10-18T00:00:00.000Z",
    sscReceivedBy: "ssc-1",
    sscRevision: 3,
    status: "draft",
    updatedAt: "2026-10-18T00:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.complete.mockResolvedValue(createDraft({ sscConfirmationStatus: "completed" }));
  mocks.telegramLink.mockResolvedValue({ url: null });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:approval-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

interface HarnessOptions {
  canConfirm?: boolean;
  candidateId?: string;
  disabled?: boolean;
  draft?: Partial<OfferDraftRecord>;
}

function ConfirmationHarness({
  options,
  onSaved,
}: {
  options: HarnessOptions;
  onSaved: () => Promise<void>;
}) {
  const confirmation = useOfferSscConfirmation({
    canConfirm: options.canConfirm ?? true,
    candidateId: options.candidateId ?? "candidate-1",
    disabled: options.disabled ?? false,
    draft: createDraft(options.draft),
    onSaved,
    slug: "demo",
  });
  return <OfferSscActions confirmation={confirmation} isBusy={confirmation.isPending} />;
}

function renderConfirmation() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn(() => Promise.resolve());
  function rerender(options: HarnessOptions = {}) {
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConfirmationHarness onSaved={onSaved} options={options} />
        </QueryClientProvider>,
      ),
    );
  }
  rerender();
  return { host, onSaved, rerender };
}

function button(label: string, host: ParentNode = document.body) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
}

async function openDialog(host: HTMLElement) {
  await act(() => button("SSC完成确认", host)?.click());
  const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  if (!dialog) {
    throw new Error("完成确认应先打开内部审批询问");
  }
  return dialog;
}

function selectFile(dialog: HTMLElement, file: File) {
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  act(() => input?.dispatchEvent(new Event("change", { bubbles: true })));
  return input;
}

async function waitForUi(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(() => Promise.resolve());
    assertion();
  });
}

describe("SSC internal approval confirmation", () => {
  it("asks explicitly and allows completion without a screenshot", async () => {
    const { host, onSaved } = renderConfirmation();
    const dialog = await openDialog(host);
    expect(dialog.textContent).toContain("是否已经完成内部审批");
    expect(dialog.textContent).toContain("可选");
    expect(dialog.querySelector('input[type="checkbox"]')).toBeNull();
    expect(dialog.querySelector<HTMLInputElement>('input[type="file"]')?.required).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
    const confirm = button("已完成内部审批，确认完成", dialog);
    expect(confirm?.disabled).toBe(false);
    await act(() => confirm?.click());
    await waitForUi(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      "offer-1",
      { internalApprovalConfirmed: true, revision: 3 },
      null,
    );
    await waitForUi(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
  });

  it("cancels without completing and clears the selected screenshot before reopening", async () => {
    const { host } = renderConfirmation();
    const dialog = await openDialog(host);
    const file = new File(["image"], "approval.png", { type: "image/png" });
    selectFile(dialog, file);
    expect(dialog.textContent).toContain("approval.png");
    await act(() => button("取消", dialog)?.click());
    await waitForUi(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(mocks.complete).not.toHaveBeenCalled();
    const reopened = await openDialog(host);
    expect(reopened.textContent).not.toContain("approval.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:approval-preview");
  });

  it.each([
    ["image/jpeg", "approval.jpg"],
    ["image/png", "approval.png"],
    ["image/webp", "approval.webp"],
  ])("submits one optional %s screenshot with explicit approval", async (type, name) => {
    const { host } = renderConfirmation();
    const dialog = await openDialog(host);
    const file = new File(["image"], name, { type });
    selectFile(dialog, file);
    await act(() => button("已完成内部审批，确认完成", dialog)?.click());
    await waitForUi(() => expect(mocks.complete).toHaveBeenCalledOnce());
    expect(mocks.complete).toHaveBeenCalledWith(
      "demo",
      "candidate-1",
      "offer-1",
      { internalApprovalConfirmed: true, revision: 3 },
      file,
    );
  });

  it("previews a pasted screenshot and removes it without changing the offer", async () => {
    const { host } = renderConfirmation();
    const dialog = await openDialog(host);
    const file = new File(["image"], "pasted.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file] } });
    act(() => dialog.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    await act(() => {
      dialog.querySelector<HTMLButtonElement>('[aria-label="附件操作：pasted.png"]')?.click();
    });
    await act(() => button("查看")?.click());
    expect(
      document.body.querySelector<HTMLImageElement>('img[alt="审批截图预览：pasted.png"]')?.src,
    ).toBe("blob:approval-preview");
    await act(() => {
      document.body
        .querySelector('img[alt="审批截图预览：pasted.png"]')
        ?.closest('[role="dialog"]')
        ?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
        ?.click();
    });
    await act(() =>
      dialog.querySelector<HTMLButtonElement>('[aria-label="移除审批截图 pasted.png"]')?.click(),
    );
    expect(dialog.textContent).not.toContain("pasted.png");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:approval-preview");
  });

  it.each([
    { name: "approval.gif", size: 10, type: "image/gif", want: "JPEG、PNG 或 WebP" },
    { name: "approval.pdf", size: 10, type: "application/pdf", want: "JPEG、PNG 或 WebP" },
    { name: "empty.png", size: 0, type: "image/png", want: "非空" },
    { name: "large.png", size: 10 * 1024 * 1024 + 1, type: "image/png", want: "10 MB" },
  ])("rejects an invalid screenshot: $name", async ({ name, size, type, want }) => {
    const { host } = renderConfirmation();
    const dialog = await openDialog(host);
    const file = new File(["image"], name, { type });
    Object.defineProperty(file, "size", { value: size });
    selectFile(dialog, file);
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(want);
    expect(dialog.querySelector('[aria-label^="附件操作："]')).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("accepts a screenshot at the 10 MB boundary", async () => {
    const { host } = renderConfirmation();
    const dialog = await openDialog(host);
    const file = new File(["image"], "boundary.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 });
    selectFile(dialog, file);
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
    expect(dialog.textContent).toContain("boundary.png");
  });

  it("disables repeated confirmation and cancellation while submitting", async () => {
    const pending = Promise.withResolvers<OfferDraftRecord>();
    mocks.complete.mockReturnValue(pending.promise);
    const { host, onSaved } = renderConfirmation();
    const dialog = await openDialog(host);
    await act(() => button("已完成内部审批，确认完成", dialog)?.click());
    await waitForUi(() => expect(button("确认中…", dialog)?.disabled).toBe(true));
    expect(button("取消", dialog)?.disabled).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    await act(() => button("确认中…", dialog)?.click());
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
    await act(() => pending.resolve(createDraft({ sscConfirmationStatus: "completed" })));
    await waitForUi(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("keeps a failed screenshot and offers a retry with the same revision", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("Offer 内容已更新，请刷新后重新确认。"));
    const { host, onSaved } = renderConfirmation();
    const dialog = await openDialog(host);
    const file = new File(["image"], "retry.png", { type: "image/png" });
    selectFile(dialog, file);
    await act(() => button("已完成内部审批，确认完成", dialog)?.click());
    await waitForUi(() =>
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("请刷新后重新确认"),
    );
    expect(dialog.textContent).toContain("retry.png");
    expect(button("已完成内部审批，确认完成", dialog)?.disabled).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    await act(() => button("已完成内部审批，确认完成", dialog)?.click());
    await waitForUi(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(mocks.complete).toHaveBeenLastCalledWith(
      "demo",
      "candidate-1",
      "offer-1",
      { internalApprovalConfirmed: true, revision: 3 },
      file,
    );
  });

  it.each([
    { draft: { sscRevision: 4 }, label: "revision" },
    { draft: { id: "offer-2" }, label: "draft" },
    { draft: { version: 3 }, label: "version" },
    { draft: { sscConfirmationStatus: "pending" as const }, label: "SSC state" },
    { draft: { status: "deleted" as const }, label: "retired draft" },
    { canConfirm: false, label: "permission" },
    { disabled: true, label: "closed candidate" },
    { candidateId: "candidate-2", label: "candidate" },
  ])(
    "closes and discards the screenshot when $label changes",
    async ({ label: _label, ...options }) => {
      const { host, rerender } = renderConfirmation();
      const dialog = await openDialog(host);
      selectFile(dialog, new File(["image"], "outdated.png", { type: "image/png" }));
      rerender(options);
      await waitForUi(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:approval-preview");
      rerender();
      const reopened = await openDialog(host);
      expect(reopened.textContent).not.toContain("outdated.png");
    },
  );
});
