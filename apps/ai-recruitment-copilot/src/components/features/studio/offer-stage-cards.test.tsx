// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { OfferCard } from "./offer-stage-cards";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ patchOfferDraftWithAttachment: vi.fn() }));

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({
  offerApprovalAttachmentUrl: (_slug: string, _candidateId: string, draftId: string) =>
    `/offer-attachments/${draftId}`,
  patchOfferDraftWithAttachment: mocks.patchOfferDraftWithAttachment,
}));

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
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

function renderCard(mediaType: string, filename: string, canUpdate = false) {
  const onSaved = vi.fn();
  const draft: OfferDraftRecord = {
    approvalAttachment: { filename, mediaType, size: 3 },
    baseSalary: 30_000,
    bonus: null,
    candidateCounter: null,
    createdAt: "2026-09-23T00:00:00.000Z",
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
    status: "draft",
    updatedAt: "2026-09-23T00:00:00.000Z",
    version: 1,
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
          canUpdate={canUpdate}
          candidateId="candidate-1"
          disabled={!canUpdate}
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
