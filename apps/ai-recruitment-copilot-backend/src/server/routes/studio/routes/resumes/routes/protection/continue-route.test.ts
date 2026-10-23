import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { resumeProtectionContinueRouter } from "./continue-route";

const mocks = vi.hoisted(() => ({
  continue: vi.fn(),
  enqueue: vi.fn(),
  invalidate: vi.fn(),
  job: vi.fn(),
  permission: true,
  queueReady: true,
  recordJobId: "job" as string | null,
  semanticIndex: vi.fn(),
  visible: true,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission:
    () => (c: { json: (body: unknown, status: 403) => Response }, next: () => Promise<void>) =>
      mocks.permission ? next() : c.json({ error: "Forbidden" }, 403),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  resolveResumeVisibilityScope: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidate,
}));
vi.mock("@arc/resume-parse-queue/resume-review-generation", () => ({
  isResumeReviewGenerationQueueConfigured: () => mocks.queueReady,
}));
vi.mock("../../../job-descriptions/dao", () => ({ loadJobDescriptionById: mocks.job }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue", () => ({
  enqueueResumeSemanticIndexJobBestEffort: mocks.semanticIndex,
}));
vi.mock("../../dao/resumes", () => ({
  loadResumeDetail: () =>
    Promise.resolve(
      mocks.visible ? { id: "candidate", jobDescriptionId: mocks.recordJobId } : null,
    ),
}));
vi.mock("../../dao/protection/continue", () => ({
  ResumeProtectionContinuationError: class extends Error {},
  continueProtectedResume: mocks.continue,
}));
vi.mock("../../utils/review-queue", () => ({
  enqueueResumeReviewGenerationForRecordBestEffort: mocks.enqueue,
}));

const DEFAULT_BODY = { confirmed: true };

function request(body: Record<string, unknown> = DEFAULT_BODY) {
  const app = factory
    .createApp()
    .use(async (c, next) => {
      c.set("activeOrg", { id: "workspace" } as never);
      c.set("member", { role: "member" } as never);
      c.set("user", { id: "uploader" } as never);
      await next();
    })
    .route("/:id/protection/continue", resumeProtectionContinueRouter);
  return app.request("/candidate/protection/continue", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission = true;
  mocks.visible = true;
  mocks.queueReady = true;
  mocks.recordJobId = "job";
  mocks.job.mockResolvedValue({ hiringUnitId: "unit", id: "job", manuallyInactive: false });
  mocks.continue.mockResolvedValue({ jobDescriptionId: "job", needsAnalysis: true });
  mocks.enqueue.mockResolvedValue(true);
});

describe("continue recommendation endpoint", () => {
  it("requires explicit confirmation before changing admission or queuing analysis", async () => {
    const response = await request({ confirmed: false, jobDescriptionId: "job" });
    expect(response.status).toBe(400);
    expect(mocks.continue).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("checks write permission", async () => {
    mocks.permission = false;
    const response = await request();
    expect(response.status).toBe(403);
    expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("hides inaccessible candidates", async () => {
    mocks.visible = false;
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("validates the saved job against the current actor's scope", async () => {
    mocks.job.mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(400);
    expect(mocks.job).toHaveBeenCalledWith("workspace", "job", { actorUserId: "uploader" });
    expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("ignores a supplied replacement job and continues the saved destination", async () => {
    const response = await request({ confirmed: true, jobDescriptionId: "replacement-job" });
    expect(response.status).toBe(200);
    expect(mocks.job).toHaveBeenCalledWith("workspace", "job", { actorUserId: "uploader" });
    expect(mocks.continue).toHaveBeenCalledWith(
      expect.objectContaining({ jobDescriptionId: "job" }),
    );
  });
  it("does not invent a destination for an unbound record", async () => {
    mocks.recordJobId = null;
    const response = await request();
    expect(response.status).toBe(400);
    expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("does not admit when background analysis is unavailable", async () => {
    mocks.queueReady = false;
    const response = await request();
    expect(response.status).toBe(503);
    expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("queues analysis only after confirmation is committed", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analysisQueued: true, status: "accepted" });
    expect(mocks.continue).toHaveBeenCalledWith({
      jobDescriptionId: "job",
      memberRole: "member",
      organizationId: "workspace",
      recordId: "candidate",
      userId: "uploader",
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({
      jobDescriptionId: "job",
      organizationId: "workspace",
      resumeRecordId: "candidate",
      source: "resume_upload",
    });
    expect(mocks.semanticIndex).toHaveBeenCalledWith({
      organizationId: "workspace",
      sourceId: "candidate",
      sourceType: "studio_interview",
    });
    expect(mocks.continue.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueue.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("does not enqueue again for a submitted retry", async () => {
    mocks.continue.mockResolvedValue({ jobDescriptionId: "job", needsAnalysis: false });
    const response = await request();
    expect(response.status).toBe(200);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("reports a recoverable analysis start failure without losing the recommendation", async () => {
    mocks.enqueue.mockResolvedValue(false);
    const response = await request();
    expect(await response.json()).toEqual({ analysisQueued: false, status: "accepted" });
    expect(mocks.invalidate).toHaveBeenCalledWith("workspace");
  });
});
