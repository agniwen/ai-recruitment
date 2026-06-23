import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { platformRouter } from "../route";

const queueMocks = vi.hoisted(() => ({
  getResumeParseQueueOverview: vi.fn(),
  listResumeParseQueueJobs: vi.fn(),
}));

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
    await next();
  })
  .route("/platform", platformRouter);

describe("platform queue routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
