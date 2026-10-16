import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { platformRouter } from "../route";
import { SecurityError } from "../../security/mfa/service";
import type * as MfaService from "../../security/mfa/service";

const queueMocks = vi.hoisted(() => ({
  clear: vi.fn(),
  getResumeParseQueueOverview: vi.fn(),
  listResumeParseQueueJobs: vi.fn(),
  requireRecentMfa: vi.fn(),
}));

vi.mock("../../security/mfa/service", async (importOriginal) => ({
  ...(await importOriginal<typeof MfaService>()),
  requireRecentMfa: queueMocks.requireRecentMfa,
}));
afterAll(() => vi.unstubAllEnvs());
const writeHeaders = { origin: "https://arc.example.invalid" };

vi.mock("../queue-clear", () => ({ clearPendingParseJobs: queueMocks.clear }));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/mail-ingest/dao", () => ({
  createMailIngestAccount: vi.fn(),
  getMailIngestAccountLoginConfig: vi.fn(),
  isWorkspaceMember: vi.fn(),
  queryPaginatedPlatformMailIngestAccounts: vi.fn(),
  updateWorkspaceMailIngestAccount: vi.fn(),
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/mail-ingest/validation",
  () => ({
    MailIngestValidationError: class MailIngestValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "MailIngestValidationError";
      }
    },
    mergeMailIngestLoginConfig: vi.fn(),
    validateMailIngestAccountLogin: vi.fn(),
  }),
);

vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  RESUME_PARSE_JOB_LIST_STATES: [
    "all",
    "waiting",
    "active",
    "delayed",
    "failed",
    "completed",
    "paused",
    "prioritized",
    "waiting-children",
  ],
  RESUME_PARSE_QUEUE_NAME: "resume-parse",
  getResumeParseQueueOverview: queueMocks.getResumeParseQueueOverview,
  listResumeParseQueueJobs: queueMocks.listResumeParseQueueJobs,
}));

const app = factory
  .createApp()
  .use(async (c, next) => {
    c.set("user", { id: "admin_1", role: "admin" } as never);
    c.set("session", { id: "admin_session" } as never);
    await next();
  })
  .route("/platform", platformRouter);

describe("platform queue routes", () => {
  it("clears the parse queue for admins", async () => {
    queueMocks.clear.mockResolvedValue({ removed: 12 });
    const response = await app.request("/platform/queues/resume-parse/jobs", {
      headers: writeHeaders,
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 12 });
  });
  it("rejects unsupported queues", async () => {
    const response = await app.request("/platform/queues/unknown/jobs", {
      headers: writeHeaders,
      method: "DELETE",
    });
    expect(response.status).toBe(404);
    expect(queueMocks.clear).not.toHaveBeenCalled();
  });
  it("rejects non-admin queue clearing", async () => {
    const memberApp = factory
      .createApp()
      .use(async (c, next) => {
        c.set("user", { id: "member", role: "user" } as never);
        await next();
      })
      .route("/platform", platformRouter);
    const response = await memberApp.request("/platform/queues/resume-parse/jobs", {
      method: "DELETE",
    });
    expect(response.status).toBe(403);
    expect(queueMocks.clear).not.toHaveBeenCalled();
  });
  it("blocks a platform admin without recent MFA before doing privileged work", async () => {
    queueMocks.requireRecentMfa.mockRejectedValueOnce(
      new SecurityError("MFA_REQUIRED", "请先验证"),
    );
    const response = await app.request("/platform/queues/resume-parse/jobs", {
      headers: writeHeaders,
      method: "DELETE",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MFA_REQUIRED" });
    expect(queueMocks.clear).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "https://arc.example.invalid");
    queueMocks.requireRecentMfa.mockResolvedValue(new Date(Date.now() + 900_000).toISOString());
    queueMocks.listResumeParseQueueJobs.mockResolvedValue({
      page: 1,
      pageSize: 20,
      records: [
        {
          attemptsMade: 0,
          attemptsStarted: null,
          data: { unexpected: true },
          failedReason: null,
          finishedOn: null,
          id: "job-1",
          name: "parse-resume-upload-item",
          processedBy: null,
          processedOn: null,
          progress: null,
          returnvalue: null,
          state: "waiting",
          timestamp: null,
        },
      ],
      state: "all",
      total: 1,
      totalPages: 1,
    });
  });

  it("treats explicit all detail filters as unfiltered", async () => {
    const res = await app.request(
      "/platform/queues/resume-parse/jobs?page=1&pageSize=20&state=all&parseStatus=all&uploadStatus=all",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      records: [{ id: "job-1" }],
      total: 1,
    });
    expect(queueMocks.listResumeParseQueueJobs).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: undefined,
      state: "all",
    });
  });

  it("treats empty detail filter query values as all", async () => {
    const res = await app.request(
      "/platform/queues/resume-parse/jobs?page=1&pageSize=20&state=all&parseStatus=&uploadStatus=",
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      records: [{ id: "job-1" }],
      total: 1,
    });
    expect(queueMocks.listResumeParseQueueJobs).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: undefined,
      state: "all",
    });
  });
});
