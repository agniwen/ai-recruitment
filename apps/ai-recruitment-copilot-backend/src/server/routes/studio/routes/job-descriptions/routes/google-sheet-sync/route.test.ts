import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

const mocks = vi.hoisted(() => ({
  createOrGetActiveRun: vi.fn(),
  ensureEnqueue: vi.fn(),
  failRun: vi.fn(),
  failStale: vi.fn(),
  latestRun: vi.fn(),
  queueConfigured: vi.fn(),
}));

vi.mock("@arc/resume-parse-queue/job-description-google-sheet-sync", () => ({
  ensureJobDescriptionGoogleSheetSyncJobEnqueued: mocks.ensureEnqueue,
  isJobDescriptionGoogleSheetSyncQueueConfigured: mocks.queueConfigured,
}));

vi.mock("./dao", () => ({
  createOrGetActiveGoogleSheetSyncRun: mocks.createOrGetActiveRun,
  failGoogleSheetSyncRun: mocks.failRun,
  failStaleGoogleSheetSyncRuns: mocks.failStale,
  loadLatestGoogleSheetSyncRun: mocks.latestRun,
}));

// oxlint-disable-next-line import/first -- mocks must be registered before the route import.
import { googleSheetSyncRouter } from "./route";

const run = {
  createdAt: "2026-07-28T00:00:00.000Z",
  error: null,
  finishedAt: null,
  id: "sync-run-1",
  result: null,
  startedAt: null,
  status: "queued",
  updatedAt: "2026-07-28T00:00:00.000Z",
} as const;

function makeApp(role: string) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org-1" } as never);
      c.set("member", { role } as never);
      c.set("user", { id: "user-1" } as never);
      await next();
    })
    .route("/sync", googleSheetSyncRouter);
}

describe("Google Sheet sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueConfigured.mockReturnValue(true);
    mocks.createOrGetActiveRun.mockResolvedValue({ created: true, run });
    mocks.latestRun.mockResolvedValue(run);
    mocks.failStale.mockResolvedValue([]);
    mocks.ensureEnqueue.mockResolvedValue("enqueued");
  });

  it("is unavailable to non-administrator workspace roles", async () => {
    const response = await makeApp("member").request("/sync", { method: "POST" });

    expect(response.status).toBe(403);
    expect(mocks.createOrGetActiveRun).not.toHaveBeenCalled();
    expect(mocks.ensureEnqueue).not.toHaveBeenCalled();
  });

  it("persists and enqueues an administrator sync run", async () => {
    const response = await makeApp("admin").request("/sync", { method: "POST" });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(run);
    expect(mocks.failStale).toHaveBeenCalledWith({ organizationId: "org-1" });
    expect(mocks.createOrGetActiveRun).toHaveBeenCalledWith({
      organizationId: "org-1",
      requestedBy: "user-1",
    });
    expect(mocks.ensureEnqueue).toHaveBeenCalledWith({ runId: run.id });
  });

  it("re-enqueues when reusing an already-active run so Redis zombies recover", async () => {
    mocks.createOrGetActiveRun.mockResolvedValue({ created: false, run });

    const response = await makeApp("admin").request("/sync", { method: "POST" });

    expect(response.status).toBe(202);
    expect(mocks.ensureEnqueue).toHaveBeenCalledWith({ runId: run.id });
  });

  it("expires stale active runs before returning status", async () => {
    const response = await makeApp("owner").request("/sync");

    expect(response.status).toBe(200);
    expect(mocks.failStale).toHaveBeenCalledWith({ organizationId: "org-1" });
    await expect(response.json()).resolves.toEqual({ run });
    expect(mocks.latestRun).toHaveBeenCalledWith("org-1");
  });
});
