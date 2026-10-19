import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOfferCandidatePreviewLink } from "./access";
import { offerCandidatesRouter } from "./route";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  results: [] as unknown[],
  stream: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: () => {
      const query = {
        from: () => query,
        leftJoin: () => query,
        limit: () => Promise.resolve(mocks.results.shift() ?? []),
        orderBy: () => query,
        where: () => query,
      };
      return query;
    },
  },
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts",
  () => ({
    OfferDraftError: class extends Error {
      readonly status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    },
    loadAuthorizedOfferSscContext: mocks.context,
  }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  getObjectStream: mocks.stream,
}));

const draft = {
  baseSalary: 30_000,
  bonus: 60_000,
  currency: "CNY",
  equity: "100 shares",
  expiresAt: "2026-10-25T00:00:00.000Z",
  id: "550e8400-e29b-41d4-a716-446655440000",
  interviewRecordId: "candidate-a",
  joiningDate: "2026-11-01T00:00:00.000Z",
  notes: "入职说明",
  organizationId: "org-a",
  position: "工程师",
  sscCompletedAt: null,
  sscCompletionAttachment: { storageKey: "internal-approval-secret" },
  sscConfirmationStatus: "pending",
  sscReceivedAt: null,
  sscRevision: 3,
  status: "draft",
  version: 1,
};
const candidate = {
  candidateName: "测试候选人",
  createdBy: "private-user-id",
  departmentName: "工程部",
  hrResumeAssessment: "private HR assessment",
  jobDescription: "负责系统开发",
  jobName: "后端开发",
  resumeFileName: "candidate.pdf",
  resumeProfile: {
    age: 28,
    educationExperiences: [],
    email: "candidate@example.test",
    gender: null,
    name: "测试候选人",
    personalStrengths: ["代码质量"],
    phone: "123456789",
    projectExperiences: [],
    schools: ["测试大学"],
    scoringFacts: { internalScore: "secret" },
    skills: ["TypeScript"],
    targetRoles: ["工程师"],
    workExperiences: [],
    workYears: 5,
  },
  resumeStorageKey: "private/candidate.pdf",
};

function token() {
  return (
    new URL(
      buildOfferCandidatePreviewLink({
        actorUserId: "ssc-user",
        candidateId: draft.interviewRecordId,
        draftId: draft.id,
        organizationId: draft.organizationId,
        revision: draft.sscRevision,
      }) ?? "",
    ).pathname
      .split("/")
      .at(-1) ?? ""
  );
}

function app() {
  return new Hono().route("/api/public/offer-candidates/:token", offerCandidatesRouter);
}

describe("Anonymous Offer candidate preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T06:00:00.000Z"));
    vi.stubEnv("BETTER_AUTH_SECRET", "test-preview-secret");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test");
    mocks.context
      .mockReset()
      .mockResolvedValue({ canConfirm: true, canReceive: true, draft, pipelineStage: "offer" });
    mocks.results = [[{ id: "550e8400-e29b-41d4-a716-446655440000" }], [candidate]];
    mocks.stream.mockReset().mockImplementation((key: string) => {
      if (key !== "private/candidate.pdf") {
        throw new Error("Unexpected unscoped storage key");
      }
      return Promise.resolve({
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("test-pdf"));
            controller.close();
          },
        }),
        contentLength: 8,
        contentType: "application/pdf",
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns only the approved candidate, job and Offer fields without a session", async () => {
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidate.name).toBe("测试候选人");
    expect(body.candidate.profile.skills).toEqual(["TypeScript"]);
    expect(body.candidate.hasResumeFile).toBe(true);
    expect(body.job).toEqual({
      departmentName: "工程部",
      description: "负责系统开发",
      name: "后端开发",
    });
    expect(body.offer.baseSalary).toBe(30_000);
    expect(body.offer.bonus).toBe(60_000);
    expect(body.offer.sscConfirmationStatus).toBe("pending");
    expect(body.linkExpiresAt).toBe("2026-10-26T06:00:00.000Z");
    const serialized = JSON.stringify(body);
    for (const privateValue of [
      "scoringFacts",
      "private HR assessment",
      "private-user-id",
      "internal-approval-secret",
      "private/candidate.pdf",
      "actorUserId",
      "organizationId",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("uses a fresh Offer status when the same link is read after SSC confirmation", async () => {
    const credential = token();
    mocks.context.mockResolvedValue({
      draft: {
        ...draft,
        sscCompletedAt: "2026-10-19T06:01:00.000Z",
        sscConfirmationStatus: "completed",
      },
    });
    const response = await app().request(`/api/public/offer-candidates/${credential}`);
    const body = await response.json();
    expect(body.offer.sscConfirmationStatus).toBe("completed");
  });

  it.each([
    { id: "different-offer" },
    { organizationId: "different-org" },
    { interviewRecordId: "different-candidate" },
    { sscRevision: 4 },
    { sscConfirmationStatus: null },
    { expiresAt: "2026-10-19T06:00:00.000Z" },
    { status: "deleted" },
    { status: "superseded" },
    { status: "expired" },
  ])("rejects a revoked or mismatched Offer context: %j", async (override) => {
    const credential = token();
    mocks.context.mockResolvedValue({ draft: { ...draft, ...override } });
    const response = await app().request(`/api/public/offer-candidates/${credential}`);
    expect(response.status).toBe(404);
  });

  it("does not revive an old link when a newer Offer is a deleted tombstone", async () => {
    mocks.results = [[{ id: "newer-deleted-offer" }]];
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(404);
  });

  it("rejects the link after the SSC actor loses candidate access or is disabled", async () => {
    const credential = token();
    const { OfferDraftError } =
      await import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts");
    mocks.context.mockRejectedValue(new OfferDraftError("No access", 403));
    const response = await app().request(`/api/public/offer-candidates/${credential}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("No access");
  });

  it("returns a uniform unavailable result for malformed credentials", async () => {
    const response = await app().request("/api/public/offer-candidates/invalid-token");
    expect(response.status).toBe(404);
  });

  it("streams the bound candidate resume without exposing a storage address", async () => {
    const response = await app().request(
      `/api/public/offer-candidates/${token()}/resume?storageKey=private/other.pdf`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("test-pdf");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toContain("candidate.pdf");
  });

  it("applies revocation to the resume stream as well", async () => {
    const credential = token();
    mocks.results = [[{ id: "newer-offer" }]];
    const response = await app().request(`/api/public/offer-candidates/${credential}/resume`);
    expect(response.status).toBe(404);
  });

  it.each(["candidate.html", "candidate.svg", "candidate.docx", "candidate.__proto__"])(
    "downloads an unsafe or office format without trusting its stored content type: %s",
    async (resumeFileName) => {
      mocks.results = [[{ id: draft.id }], [{ ...candidate, resumeFileName }]];
      mocks.stream.mockResolvedValue({
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        contentType: "text/html",
      });
      const response = await app().request(`/api/public/offer-candidates/${token()}/resume`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/u);
      expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    },
  );

  it("serves PDF with a fixed safe media type even if storage claims HTML", async () => {
    mocks.stream.mockResolvedValue({
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      contentType: "text/html",
    });
    const response = await app().request(`/api/public/offer-candidates/${token()}/resume`);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  it("does not expose a resume storage failure", async () => {
    mocks.stream.mockResolvedValue(null);
    const response = await app().request(`/api/public/offer-candidates/${token()}/resume`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("private/candidate.pdf");
  });

  it("does not register any write action on an anonymous link", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await app().request(`/api/public/offer-candidates/${token()}`, { method });
      expect(response.status).toBe(404);
    }
  });
});
