// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfferDraftRecord, OfferSscState } from "@arc/shared/studio-pipeline-stages";
import { OfferStagePanel } from "./offer-stage-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fetchStudioResume: vi.fn(),
  getCurrentOfferSscState: vi.fn(),
  getOfferSscTelegramLink: vi.fn(),
  listOfferDrafts: vi.fn(),
  receiveOfferSscConfirmation: vi.fn(),
}));

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));
vi.mock("@/lib/client/api", () => ({
  fetchStudioResume: mocks.fetchStudioResume,
  getCurrentOfferSscState: mocks.getCurrentOfferSscState,
  getOfferSscTelegramLink: mocks.getOfferSscTelegramLink,
  listOfferDrafts: mocks.listOfferDrafts,
  receiveOfferSscConfirmation: mocks.receiveOfferSscConfirmation,
}));

const roots: ReturnType<typeof createRoot>[] = [];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchStudioResume.mockResolvedValue(null);
  mocks.getOfferSscTelegramLink.mockResolvedValue({ url: null });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  for (const client of clients.splice(0)) {
    client.clear();
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function makeDraft(overrides: Partial<OfferDraftRecord> = {}): OfferDraftRecord {
  return {
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
    responseAt: null,
    sentAt: null,
    sscCompletedAt: null,
    sscCompletedBy: null,
    sscConfirmationStatus: "pending",
    sscReceivedAt: null,
    sscReceivedBy: null,
    sscRevision: 1,
    status: "draft",
    updatedAt: "2026-10-17T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeState(overrides: Partial<OfferSscState> = {}): OfferSscState {
  return {
    id: "offer-1",
    sscConfirmationStatus: "pending",
    status: "draft",
    version: 1,
    ...overrides,
  };
}

async function waitForPanel(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(() => Promise.resolve());
      check();
    },
    { interval: 20, timeout: 3000 },
  );
}

async function renderPanel(
  drafts: OfferDraftRecord[],
  current: OfferSscState | null,
  canReceive = false,
) {
  mocks.listOfferDrafts.mockResolvedValue(drafts);
  mocks.getCurrentOfferSscState.mockResolvedValue(current);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <OfferStagePanel
          canConfirm={false}
          canCreate={false}
          canDelete={false}
          canReceive={canReceive}
          canUpdate={false}
          candidateEmail={null}
          candidateId="candidate-1"
          candidateName="测试候选人"
        />
      </QueryClientProvider>,
    );
  });
  await waitForPanel(() => {
    expect(client.getQueryState(["offer-drafts", "demo", "candidate-1"])?.status).toBe("success");
    expect(client.getQueryState(["offer-ssc-state", "demo", "candidate-1"])?.status).toBe(
      "success",
    );
    expect(host.querySelector('[aria-label="SSC确认进度"]')).not.toBeNull();
    expect(host.textContent).not.toContain("加载中");
  });
  return host;
}

describe("OfferStagePanel SSC progress", () => {
  it.each([
    ["pending", "Offer新增"],
    ["confirming", "确认中"],
    ["completed", "已完成确认"],
  ] as const)("shows all SSC steps to a read-only viewer and marks %s", async (status, label) => {
    const host = await renderPanel(
      [makeDraft({ sscConfirmationStatus: status })],
      makeState({ sscConfirmationStatus: status }),
    );
    const progress = host.querySelector('[aria-label="SSC确认进度"]');
    expect(progress).not.toBeNull();
    expect(progress?.textContent).toContain("Offer新增");
    expect(progress?.textContent).toContain("确认中");
    expect(progress?.textContent).toContain("已完成确认");
    expect(progress?.textContent).toContain("SSC接收确认");
    expect(progress?.textContent).toContain("SSC完成确认");
    expect(progress?.querySelector('[aria-current="step"]')?.textContent).toContain(label);
    expect(progress?.querySelector("button")).toBeNull();
  });

  it("uses the current summary independently from the visible version list", async () => {
    const host = await renderPanel(
      [
        makeDraft({ id: "offer-2", version: 2 }),
        makeDraft({ id: "offer-3", sscConfirmationStatus: "completed", version: 3 }),
      ],
      makeState({ id: "offer-4", sscConfirmationStatus: "confirming", version: 4 }),
    );
    const progress = host.querySelector('[aria-label="SSC确认进度"]');
    expect(progress?.textContent).toContain("v4");
    expect(progress?.querySelector('[aria-current="step"]')?.textContent).toContain("确认中");
  });

  it("does not fall back to an older draft when the highest version is superseded", async () => {
    const host = await renderPanel(
      [makeDraft({ id: "offer-2", version: 2 })],
      makeState({ id: "offer-3", status: "superseded", version: 3 }),
    );
    const progress = host.querySelector('[aria-label="SSC确认进度"]');
    expect(progress?.textContent).toContain("v3");
    expect(progress?.textContent).toContain("已被新版替代");
    expect(progress?.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("shows a deleted current version without using an older completed offer as current", async () => {
    const host = await renderPanel(
      [makeDraft({ sscConfirmationStatus: "completed" })],
      makeState({
        id: "offer-2",
        sscConfirmationStatus: "completed",
        status: "deleted",
        version: 2,
      }),
    );
    const progress = host.querySelector('[aria-label="SSC确认进度"]');
    expect(progress?.textContent).toContain("v2");
    expect(progress?.textContent).toContain("已删除");
    expect(progress?.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("explains historical offers without pretending SSC has already started", async () => {
    const host = await renderPanel(
      [makeDraft({ sscConfirmationStatus: null, version: 3 })],
      makeState({ sscConfirmationStatus: null, version: 3 }),
    );
    const progress = host.querySelector('[aria-label="SSC确认进度"]');
    expect(progress?.textContent).toContain("历史 Offer");
    expect(progress?.textContent).toContain("未启用 SSC 确认流程");
    expect(progress?.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("explains that an offer must be created before SSC confirmation can start", async () => {
    const host = await renderPanel([], null);
    const progress = host.querySelector('[aria-label="SSC确认进度"]');
    expect(progress?.textContent).toContain("尚无 Offer 版本");
    expect(progress?.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("refreshes the current summary after SSC receives an offer", async () => {
    const host = await renderPanel([makeDraft()], makeState(), true);
    const received = makeDraft({ sscConfirmationStatus: "confirming", sscRevision: 2 });
    mocks.receiveOfferSscConfirmation.mockResolvedValue(received);
    mocks.listOfferDrafts.mockResolvedValue([received]);
    mocks.getCurrentOfferSscState.mockResolvedValue(
      makeState({ sscConfirmationStatus: "confirming" }),
    );
    const receive = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "SSC接收确认",
    );
    expect(receive?.disabled).toBe(false);
    await act(() => {
      receive?.click();
    });
    await waitForPanel(() => {
      const progress = host.querySelector('[aria-label="SSC确认进度"]');
      expect(progress?.querySelector('[aria-current="step"]')?.textContent).toContain("确认中");
      expect(mocks.getCurrentOfferSscState).toHaveBeenCalledTimes(2);
    });
  });
});
