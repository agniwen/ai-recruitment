import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOfferCandidatePreviewLink } from "./access";
import { offerCandidatesRouter } from "./route";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  humanRounds: vi.fn(),
  results: [] as unknown[],
  stream: vi.fn(),
  timeline: vi.fn(),
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
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds",
  () => ({ listHumanInterviewRounds: mocks.humanRounds }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/timeline",
  () => ({ loadCandidateTimeline: mocks.timeline }),
);

const dimension = { basis: "job", rationale: "匹配岗位要求", score: 82 };
const review = {
  detailedOverall: {
    judgment: "建议进入下一轮",
    matchingEvidence: "具备相关开发经验",
    risks: "需进一步核实项目职责",
  },
  dimensions: {
    educationBackground: dimension,
    experienceRelevance: dimension,
    potential: dimension,
    projectMatch: dimension,
    skillMatch: { ...dimension, internalPrompt: "private AI prompt" },
    stability: dimension,
  },
  internalPrompt: "private AI prompt",
  levelRecommendation: null,
  nextStep: {
    action: "interview",
    disclaimer: "以上为初步结论",
    interviewFocus: ["核实项目职责"],
    rationale: "符合岗位核心要求",
  },
  overall: { baseScore: 82, conclusion: "建议面试", scoreRationale: "经验相关" },
  schemaVersion: 5,
  teamPositioning: null,
  version: 5,
};

const humanRound = {
  cancelReason: "private cancellation notes",
  cancelledAt: null,
  completedAt: "2026-10-18T08:30:00.000Z",
  externalInterviewers: [{ email: "private-interviewer@example.test", name: "外部面试官" }],
  feedback: "项目经验扎实，面试通过。",
  format: "online",
  id: "private-round-id",
  interviewRecordId: "candidate-a",
  interviewers: [{ id: "private-interviewer-id", image: "private-avatar-url", name: "王面试官" }],
  label: "技术复面",
  meetingUrl: "https://private-meeting.example.test/invite-secret",
  notes: "private interview notes",
  organizationId: "org-a",
  outcome: "pass",
  scheduledAt: "2026-10-18T08:00:00.000Z",
  score: 85,
  sortOrder: 1,
  status: "completed",
};

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
  candidateEmail: "manual@example.test",
  candidateName: "测试候选人",
  candidatePhone: "13800000000",
  createdBy: "private-user-id",
  departmentName: "工程部",
  hiringUnitName: "研发组织",
  hrResumeAssessment: "private HR assessment",
  jobDescription: "负责系统开发",
  jobName: "后端开发",
  recommendationText: "项目交付经验丰富",
  recruitmentSource: null,
  recruitmentSourceDetail: null,
  resumeEvaluationStatus: "pass",
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
  resumeReview: review,
  resumeReviewGeneratedAt: new Date("2026-10-17T08:00:00.000Z"),
  resumeReviewStatus: "ready",
  resumeScreeningEvaluatedAt: new Date("2026-10-17T08:00:00.000Z"),
  resumeScreeningResult: {
    policyEmpty: false,
    policyEnabled: true,
    policyHash: "private-policy-hash",
    policyVersion: 1,
    recommendation: "pass",
    ruleResults: [
      {
        evidence: [
          {
            explanation: "有五年开发经验",
            fieldPath: "private-profile-path",
            quote: "后端开发五年",
            source: "resume_profile",
          },
        ],
        label: "最低工作年限：3 年",
        reason: "工作年限满足要求。",
        ruleId: "private-policy-rule-id",
        severity: "warning",
        status: "pass",
        type: "field",
      },
    ],
  },
  resumeScreeningStatus: "ready",
  resumeStorageKey: "private/candidate.pdf",
  targetRole: "高级工程师",
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
    mocks.humanRounds.mockReset().mockResolvedValue([humanRound]);
    mocks.timeline.mockReset().mockResolvedValue({
      events: [
        {
          action: "private-action",
          actorImage: "https://private-avatar.example.test",
          actorName: "招聘负责人",
          availableTimeSlots: [{ endAt: "private-slot", startAt: "private-slot" }],
          description: "private audit notes and meeting credentials",
          id: "private-audit-id",
          kind: "stage",
          metadata: [
            { label: "状态", value: "Offer" },
            { label: "入职密码", value: "private-entry-secret" },
          ],
          occurredAt: "2026-10-18T08:00:00.000Z",
          title: "候选人阶段流转",
          tone: "info",
        },
      ],
    });
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
    expect(body.candidate.id).toBe(draft.interviewRecordId);
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

  it("includes the confirmed Offer snapshot without recomputing it from live candidate data", async () => {
    mocks.context.mockResolvedValue({
      canConfirm: true,
      canReceive: true,
      draft: {
        ...draft,
        confirmationInfo: {
          candidateName: "确认时姓名",
          interviewFeedback: "确认时评价",
          probationSalary: 10_000,
        },
      },
      pipelineStage: "offer",
    });
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.offer.confirmationInfo).toEqual({
      candidateName: "确认时姓名",
      interviewFeedback: "确认时评价",
      probationSalary: 10_000,
    });
    expect(body.candidate.name).toBe("测试候选人");
  });

  it("includes the completed recruitment snapshot and SSC-confirmed preboarding date", async () => {
    const completionInfo = {
      candidateCode: "ZCLT00089",
      candidateName: "确认时姓名",
      candidatePrivateTelegram: "@candidate_private",
      preboardingDate: "2026-11-01",
      recruiterTelegram: "@recruiter_source",
      recruitingGroupNames: ["中诚渠道"],
      recruitmentChannel: "TG",
      resumeSource: "林图",
    };
    mocks.context.mockResolvedValue({
      draft: {
        ...draft,
        completionInfo,
        preboardingDate: "2026-11-01",
        sscConfirmationStatus: "completed",
      },
    });
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.offer).toMatchObject({ completionInfo, preboardingDate: "2026-11-01" });
    expect(body.candidate.name).toBe("测试候选人");
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

  it("shares the original candidate identity and a scoped, redacted activity rail", async () => {
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidate.info).toMatchObject({
      email: "manual@example.test",
      hiringUnitName: "研发组织",
      phone: "13800000000",
      recommendationText: "项目交付经验丰富",
      resumeEvaluationLabel: "通过",
      targetRole: "高级工程师",
    });
    expect(body.timeline).toEqual([
      {
        actorName: "招聘负责人",
        kind: "stage",
        metadata: [{ label: "状态", value: "Offer" }],
        occurredAt: "2026-10-18T08:00:00.000Z",
        title: "候选人阶段流转",
        tone: "info",
      },
    ]);
    expect(mocks.timeline).toHaveBeenCalledExactlyOnceWith("candidate-a", "org-a", { kind: "all" });
    for (const value of [
      "private-audit-id",
      "private-avatar.example.test",
      "private audit notes",
      "private-action",
      "private-entry-secret",
      "private-slot",
    ]) {
      expect(JSON.stringify(body)).not.toContain(value);
    }
  });

  it("does not load the activity rail while opening the original resume file", async () => {
    const response = await app().request(`/api/public/offer-candidates/${token()}/resume`);
    expect(response.status).toBe(200);
    expect(mocks.timeline).not.toHaveBeenCalled();
  });

  it("returns the stored AI review and real human interview feedback for the signed candidate", async () => {
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.aiReview).toMatchObject({
      generatedAt: "2026-10-17T08:00:00.000Z",
      review: { overall: { baseScore: 82, conclusion: "建议面试" }, schemaVersion: 5 },
      status: "ready",
    });
    expect(body.humanInterviews).toEqual([
      {
        cancelledAt: null,
        completedAt: "2026-10-18T08:30:00.000Z",
        feedback: "项目经验扎实，面试通过。",
        format: "online",
        interviewers: [{ name: "王面试官" }, { name: "外部面试官" }],
        label: "技术复面",
        outcome: "pass",
        scheduledAt: "2026-10-18T08:00:00.000Z",
        score: 85,
        sortOrder: 1,
        status: "completed",
      },
    ]);
    expect(mocks.humanRounds).toHaveBeenCalledExactlyOnceWith("candidate-a", "org-a");
    expect(body.screening).toEqual({
      evaluatedAt: "2026-10-17T08:00:00.000Z",
      result: {
        policyEmpty: false,
        recommendation: "pass",
        ruleResults: [
          {
            evidence: [{ explanation: "有五年开发经验", quote: "后端开发五年" }],
            label: "最低工作年限：3 年",
            reason: "工作年限满足要求。",
            severity: "warning",
            status: "pass",
          },
        ],
      },
      status: "ready",
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "internalPrompt",
      "private AI prompt",
      "private cancellation notes",
      "private interview notes",
      "private-interviewer@example.test",
      "private-round-id",
      "private-interviewer-id",
      "private-avatar-url",
      "invite-secret",
      "private-policy-hash",
      "private-policy-rule-id",
      "private-profile-path",
      "policyHash",
      "policyVersion",
      "ruleId",
      "fieldPath",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns empty sections for a candidate without a valid AI review or human interview", async () => {
    mocks.results = [
      [{ id: draft.id }],
      [
        {
          ...candidate,
          resumeReview: { internalPrompt: "private AI prompt" },
          resumeReviewGeneratedAt: null,
          resumeReviewStatus: "idle",
          resumeScreeningEvaluatedAt: null,
          resumeScreeningResult: { policyHash: "private-policy-hash" },
          resumeScreeningStatus: "idle",
        },
      ],
    ];
    mocks.humanRounds.mockResolvedValue([]);
    const response = await app().request(`/api/public/offer-candidates/${token()}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.aiReview).toEqual({ generatedAt: null, review: null, status: "idle" });
    expect(body.humanInterviews).toEqual([]);
    expect(body.screening).toEqual({ evaluatedAt: null, result: null, status: "idle" });
    expect(JSON.stringify(body)).not.toContain("private AI prompt");
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
    expect(mocks.humanRounds).not.toHaveBeenCalled();
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
    expect(mocks.humanRounds).not.toHaveBeenCalled();
  });

  it("returns a uniform unavailable result for malformed credentials", async () => {
    const response = await app().request("/api/public/offer-candidates/invalid-token");
    expect(response.status).toBe(404);
    expect(mocks.humanRounds).not.toHaveBeenCalled();
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
