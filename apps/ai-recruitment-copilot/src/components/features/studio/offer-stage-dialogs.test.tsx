// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { AcceptedConfirmDialog, CreateOrEditOfferDialog } from "./offer-stage-dialogs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
const mocks = vi.hoisted(() => ({
  createOfferDraft: vi.fn(),
  createOfferDraftWithAttachment: vi.fn(),
  getOfferCreationContext: vi.fn(),
}));
vi.mock("@/lib/client/api", () => ({
  createOfferDraft: mocks.createOfferDraft,
  createOfferDraftWithAttachment: mocks.createOfferDraftWithAttachment,
  getOfferCreationContext: mocks.getOfferCreationContext,
  patchOfferDraft: vi.fn(),
  respondOfferDraft: vi.fn(),
}));

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOfferDraft.mockResolvedValue({ id: "offer-1" });
  mocks.getOfferCreationContext.mockResolvedValue({
    defaults: {
      candidateCode: null,
      candidateName: "候选人",
      departmentName: null,
      directManager: null,
      gender: null,
      hiringUnitName: null,
      interviewFeedback: null,
      interviewRoundId: null,
      jobLevel: null,
      jobType: null,
      mainInterviewerName: null,
      managementSequence: null,
      personnelType: null,
      probationPeriod: null,
      probationSalary: null,
      serviceUnit: null,
      workLocation: null,
      workMode: null,
    },
    interviewRounds: [],
    resume: { available: false, filename: "resume.pdf", mediaType: "application/pdf" },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function renderDialog() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onSaved = vi.fn();
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateOrEditOfferDialog
          candidateEmail={null}
          candidateId="candidate-1"
          mode="create"
          onOpenChange={vi.fn()}
          onSaved={onSaved}
          open={true}
        />
      </QueryClientProvider>,
    );
  });
  return { dialog: document.body.querySelector<HTMLElement>('[role="dialog"]'), onSaved };
}

describe("new Offer without ODC attachments", () => {
  it("creates an offer as JSON and ignores pasted files without exposing upload controls", async () => {
    const { dialog, onSaved } = renderDialog();
    expect(dialog?.querySelector('input[type="file"]')).toBeNull();
    expect(dialog?.textContent).not.toContain("SSC审核材料");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [new File(["image"], "odc.png", { type: "image/png" })] },
    });
    act(() => dialog?.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(false);
    expect(dialog?.textContent).not.toContain("odc.png");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    for (const [id, value] of [
      ["offer-position", "工程师"],
      ["offer-base", "30000"],
    ]) {
      const input = dialog?.querySelector<HTMLInputElement>(`#${id}`);
      expect(input).not.toBeNull();
      act(() => {
        setValue?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    const next = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "下一步：确认信息",
    );
    expect(next?.disabled).toBe(false);
    await act(() => next?.click());
    await vi.waitFor(() =>
      expect(document.querySelector("#offer-confirm-candidateCode")).not.toBeNull(),
    );
    expect(mocks.createOfferDraft).not.toHaveBeenCalled();
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "确认创建",
    );
    await act(() => confirm?.click());
    await vi.waitFor(async () => {
      await act(() => Promise.resolve());
      expect(onSaved).toHaveBeenCalledOnce();
    });
    expect(mocks.createOfferDraft).toHaveBeenCalledExactlyOnceWith(
      "demo",
      "candidate-1",
      expect.objectContaining({ baseSalary: 30_000, position: "工程师", sendImmediately: false }),
    );
    expect(mocks.createOfferDraftWithAttachment).not.toHaveBeenCalled();
  });
});
describe("Offer custom currency", () => {
  it("shows a required description for Other and removes it when switching to GBP", async () => {
    renderDialog();
    const trigger = document.body.querySelector<HTMLButtonElement>('[id$="-currency"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain("人民币 CNY");
    await act(() => trigger?.click());
    const other = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("其他"),
    );
    expect(other).toBeDefined();
    await act(() => other?.click());
    const input = document.body.querySelector<HTMLInputElement>('[id$="-currency-description"]');
    expect(input?.required).toBe(true);
    expect(input?.maxLength).toBe(100);
    expect(input?.value).toBe("");
    await act(() => trigger?.click());
    const gbp = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("GBP"),
    );
    await act(() => gbp?.click());
    expect(document.body.querySelector('[id$="-currency-description"]')).toBeNull();
    expect(trigger?.textContent).toContain("GBP");
  });
});

describe("Offer hiring confirmation", () => {
  it.each(["pending", "confirming", "completed", null] as const)(
    "gates new SSC offers while retaining historical hiring: %s",
    (sscConfirmationStatus) => {
      const onProceed = vi.fn();
      const draft: OfferDraftRecord = {
        approvalAttachment: null,
        baseSalary: 30_000,
        bonus: null,
        candidateCounter: null,
        createdAt: "2026-10-17T00:00:00.000Z",
        currency: "CNY",
        equity: null,
        expiresAt: null,
        id: "offer-1",
        interviewRecordId: "candidate-1",
        joiningDate: null,
        notes: null,
        organizationId: "org-1",
        position: "工程师",
        responseAt: "2026-10-17T00:00:00.000Z",
        sentAt: "2026-10-17T00:00:00.000Z",
        sscCompletedAt: null,
        sscCompletedBy: null,
        sscConfirmationStatus,
        sscReceivedAt: null,
        sscReceivedBy: null,
        sscRevision: 1,
        status: "accepted",
        updatedAt: "2026-10-17T00:00:00.000Z",
        version: 1,
      };
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      act(() => {
        root.render(
          <AcceptedConfirmDialog draft={draft} onOpenChange={vi.fn()} onProceed={onProceed} />,
        );
      });
      const proceed = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "标记为已到岗",
      );
      const isBlocked =
        sscConfirmationStatus === "pending" || sscConfirmationStatus === "confirming";
      expect(proceed?.disabled).toBe(isBlocked);
      act(() => {
        proceed?.click();
      });
      expect(onProceed).toHaveBeenCalledTimes(isBlocked ? 0 : 1);
    },
  );
});
