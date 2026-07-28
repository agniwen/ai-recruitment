/* oxlint-disable max-lines -- route-level behavior tests share one fully mocked resume router harness. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

const mocks = vi.hoisted(() => ({
  applyJobDescriptionChangeEffects: vi.fn(),
  autoBindApplicableTemplates: vi.fn(),
  buildScheduleRows: vi.fn(),
  createResumeRecordFromStorage: vi.fn(),
  deleteDuplicateMatchesForSource: vi.fn(),
  deleteResumeSemanticIndexBestEffort: vi.fn(),
  deleteReturning: vi.fn(),
  enqueueResumeReassessmentForRecord: vi.fn(),
  enqueueResumeSemanticIndexJobBestEffort: vi.fn(),
  findSemanticResumeDuplicates: vi.fn(),
  insertedValues: [] as Record<string, unknown>[],
  invalidateStudioInterviewCaches: vi.fn(),
  jobDescriptionIdsExist: vi.fn(),
  listCandidateRounds: vi.fn(),
  listDuplicateMatchesForSource: vi.fn(),
  loadCandidateTimeline: vi.fn(),
  loadHiringUnitById: vi.fn(),
  loadInterviewRoundDetail: vi.fn(),
  loadJobDescriptionById: vi.fn(),
  loadOrCreateActiveInterviewContextSnapshot: vi.fn(),
  loadResumeDetail: vi.fn(),
  loadResumeDetailForAuthenticatedReviewer: vi.fn(),
  loadResumeLibraryMetrics: vi.fn(),
  permissionChecks: [] as [string, string][],
  queryPaginatedResumeRecords: vi.fn(),
  removeImportedInterviewFromConversations: vi.fn(),
  replaceDuplicateMatchesForSource: vi.fn(),
  resolveRecruitingVisibilityScope: vi.fn(),
  resolveResumeUploadStorage: vi.fn(),
  submitResumeEvaluationOnce: vi.fn(),
  transaction: vi.fn(),
  updatePatches: [] as Record<string, unknown>[],
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    delete: () => ({
      where: () => ({ returning: mocks.deleteReturning }),
    }),
    select: () => {
      const query = {
        leftJoin: () => query,
        where: () => ({ limit: () => Promise.resolve([{ id: "unit-1" }]) }),
      };
      return { from: () => query };
    },
    transaction: mocks.transaction,
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  getObjectBytes: vi.fn(),
  getObjectStream: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility", () => ({
  resolveRecruitingVisibilityScope: mocks.resolveRecruitingVisibilityScope,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: mocks.invalidateStudioInterviewCaches,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/chat/dao/chat", () => ({
  removeImportedInterviewFromConversations: mocks.removeImportedInterviewFromConversations,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/resume-analysis-agent", () => ({
  parseResumeFastToProfile: vi.fn(),
  validateResumeFile: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission:
    (resource: string, action: string) => (_c: unknown, next: () => Promise<void>) => {
      mocks.permissionChecks.push([resource, action]);
      return next();
    },
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/resumes",
  () => ({
    loadResumeDetail: mocks.loadResumeDetail,
    loadResumeDetailForAuthenticatedReviewer: mocks.loadResumeDetailForAuthenticatedReviewer,
    queryPaginatedResumeRecords: mocks.queryPaginatedResumeRecords,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/metrics",
  () => ({
    loadResumeLibraryMetrics: mocks.loadResumeLibraryMetrics,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/evaluation",
  () => ({
    submitResumeEvaluationOnce: mocks.submitResumeEvaluationOnce,
    updateResumeEvaluationStatus: vi.fn(),
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/job-change-reset",
  () => ({
    JOB_DESCRIPTION_CHANGE_PIPELINE_RESET: {
      closedAt: null,
      closedMeta: null,
      closedReason: null,
      outcome: "in_pipeline",
      pipelineStage: "screening",
    },
    applyJobDescriptionChangeEffects: mocks.applyJobDescriptionChangeEffects,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/timeline",
  () => ({ loadCandidateTimeline: mocks.loadCandidateTimeline }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/skills",
  () => ({ listOrgSkillSuggestions: vi.fn(), syncResumeSkills: vi.fn() }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/interview/utils", () => ({
  buildScheduleRows: mocks.buildScheduleRows,
  normalizeResumeFile: () => null,
  resolveResumeUploadStorage: mocks.resolveResumeUploadStorage,
  storeInterviewResume: vi.fn(),
  toBadRequest: (error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
    status: 400,
  }),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/interview-rounds",
  () => ({
    listInterviewRoundsForCandidate: mocks.listCandidateRounds,
    loadInterviewRoundDetail: mocks.loadInterviewRoundDetail,
  }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/dedup-service", () => ({
  findSemanticResumeDuplicates: mocks.findSemanticResumeDuplicates,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/duplicate-matches", () => ({
  deleteDuplicateMatchesForSource: mocks.deleteDuplicateMatchesForSource,
  listDuplicateMatchesForSource: mocks.listDuplicateMatchesForSource,
  replaceDuplicateMatchesForSource: mocks.replaceDuplicateMatchesForSource,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue", () => ({
  enqueueResumeSemanticIndexJobBestEffort: mocks.enqueueResumeSemanticIndexJobBestEffort,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/lifecycle", () => ({
  deleteResumeSemanticIndexBestEffort: mocks.deleteResumeSemanticIndexBestEffort,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interview-questions/dao/bindings",
  () => ({ autoBindApplicableTemplates: mocks.autoBindApplicableTemplates }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/context-snapshots",
  () => ({
    loadOrCreateActiveInterviewContextSnapshot: mocks.loadOrCreateActiveInterviewContextSnapshot,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao",
  () => ({
    jobDescriptionIdsExist: mocks.jobDescriptionIdsExist,
    loadJobDescriptionById: mocks.loadJobDescriptionById,
  }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao", () => ({
  loadHiringUnitById: mocks.loadHiringUnitById,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/create-from-storage",
  () => ({ createResumeRecordFromStorage: mocks.createResumeRecordFromStorage }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/profile-sync",
  () => ({ syncResumeProfileIdentity: (profile: unknown) => profile }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/review-generation",
  () => ({
    generateResumeReviewBestEffort: vi.fn(),
    generateResumeScreeningBestEffort: vi.fn(),
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/review-queue",
  () => ({
    enqueueResumeReassessmentForRecord: mocks.enqueueResumeReassessmentForRecord,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/utils/review-worker",
  () => ({ reassessResumeRecord: vi.fn() }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/pptx-preview", () => ({
  createPptxPreviewPdfResponse: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope", () => ({
  resolveHiringUnitAccessScope: vi.fn(() =>
    Promise.resolve({ canAccessAll: true, hiringUnitIds: [] }),
  ),
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { resumeLibraryRouter } from "../route";

const ORGANIZATION_ID = "org_resume_routes";
const USER_ID = "user_resume_routes";
const RECORD_ID = "resume-record-1";
const SCHEDULE_ROW = { id: "round-1", roundLabel: "AI 一面" };

const EXISTING_RECORD = {
  candidateName: "候选人",
  hiringUnitId: "unit-1",
  hrResumeAssessment: null,
  jobDescriptionId: "jd-old",
  jobDescriptionName: "旧岗位",
  outcome: "in_pipeline",
  pipelineStage: "screening",
  resumeContentHash: null,
  resumeEvaluationStatus: "pass",
  resumeFileName: null,
  resumeParseStatus: "ready",
  resumeProfile: null,
  resumeReview: null,
};

function makeApp() {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: ORGANIZATION_ID } as never);
      c.set("member", { role: "owner" } as never);
      c.set("user", { id: USER_ID } as never);
      await next();
    })
    .route("/resumes", resumeLibraryRouter);
}

describe("resumeLibraryRouter behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedValues.length = 0;
    mocks.permissionChecks.length = 0;
    mocks.updatePatches.length = 0;
    mocks.resolveRecruitingVisibilityScope.mockResolvedValue({ kind: "all" });
    mocks.resolveResumeUploadStorage.mockResolvedValue(null);
    mocks.jobDescriptionIdsExist.mockResolvedValue(true);
    mocks.loadHiringUnitById.mockResolvedValue({ id: "unit-1", name: "用人组织" });
    mocks.enqueueResumeReassessmentForRecord.mockResolvedValue("enqueued");
    mocks.buildScheduleRows.mockReturnValue([SCHEDULE_ROW]);
    mocks.loadInterviewRoundDetail.mockResolvedValue({ id: SCHEDULE_ROW.id });
    mocks.queryPaginatedResumeRecords.mockResolvedValue({
      page: 2,
      pageSize: 20,
      records: [],
      total: 1103,
      totalPages: 56,
    });
    mocks.loadResumeLibraryMetrics.mockResolvedValue({
      byPipeline: [],
      conversion: { withInterview: 0, withoutInterview: 0 },
      dailyAdded: [],
    });
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Drizzle transactions use a callback API.
    mocks.transaction.mockImplementation((callback) => {
      const tx = {
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            mocks.insertedValues.push(values);
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            mocks.updatePatches.push(patch);
            return { where: () => Promise.resolve() };
          },
        }),
      };
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- invoke the supplied transaction callback.
      return callback(tx);
    });
  });

  it("passes a known total to later list pages", async () => {
    const response = await makeApp().request("/resumes?page=2&pageSize=20&knownTotal=1103");

    expect(response.status).toBe(200);
    expect(mocks.queryPaginatedResumeRecords).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      expect.any(Object),
      expect.objectContaining({ page: "2", pageSize: "20" }),
      { kind: "all" },
      1103,
    );
  });

  it("returns resume-library metrics behind page and resource permissions", async () => {
    const response = await makeApp().request("/resumes/metrics");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      byPipeline: [],
      conversion: { withInterview: 0, withoutInterview: 0 },
      dailyAdded: [],
    });
    expect(mocks.loadResumeLibraryMetrics).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(mocks.permissionChecks).toEqual([
      ["page", "resumes"],
      ["resumeLibrary", "read"],
    ]);
  });

  it("persists duplicate matches after creating a resume-library record", async () => {
    const matches = [{ id: "duplicate-1" }];
    mocks.findSemanticResumeDuplicates.mockResolvedValue(matches);
    mocks.createResumeRecordFromStorage.mockResolvedValue(RECORD_ID);
    mocks.loadResumeDetail.mockResolvedValue({ id: RECORD_ID });

    const formData = new FormData();
    formData.set("candidateName", "候选人");
    formData.set("jobDescriptionId", "jd-new");

    const response = await makeApp().request("/resumes", { body: formData, method: "POST" });

    expect(response.status).toBe(201);
    expect(mocks.replaceDuplicateMatchesForSource).toHaveBeenCalledWith({
      matches,
      organizationId: ORGANIZATION_ID,
      sourceId: RECORD_ID,
      sourceType: "studio_interview",
    });
  });

  it("returns duplicate details only after the record passes visibility checks", async () => {
    const matches = [{ id: "duplicate-1" }];
    mocks.loadResumeDetail.mockResolvedValue({ id: RECORD_ID });
    mocks.listDuplicateMatchesForSource.mockResolvedValue(matches);

    const response = await makeApp().request(`/resumes/${RECORD_ID}/duplicate-matches`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matches });
    expect(mocks.listDuplicateMatchesForSource).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      poolOwnerUserId: USER_ID,
      sourceId: RECORD_ID,
      sourceType: "studio_interview",
    });
  });

  it("launches AI interview with an audit event and context snapshot", async () => {
    mocks.loadResumeDetail.mockResolvedValue(EXISTING_RECORD);

    const response = await makeApp().request(`/resumes/${RECORD_ID}/launch-interview`, {
      body: JSON.stringify({ interviewQuestions: [] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(mocks.insertedValues).toContainEqual(
      expect.objectContaining({
        action: "ai_interview_launched",
        interviewRecordId: RECORD_ID,
        operatorId: USER_ID,
        scheduleEntryId: SCHEDULE_ROW.id,
      }),
    );
    expect(mocks.loadOrCreateActiveInterviewContextSnapshot).toHaveBeenCalledWith({
      createdBy: USER_ID,
      interviewRecordId: RECORD_ID,
      reason: "create",
      scheduleEntryId: SCHEDULE_ROW.id,
    });
  });

  it("blocks launching AI interview after the candidate reaches a later stage", async () => {
    mocks.loadResumeDetail.mockResolvedValue({
      ...EXISTING_RECORD,
      pipelineStage: "human_interview",
    });

    const response = await makeApp().request(`/resumes/${RECORD_ID}/launch-interview`, {
      body: JSON.stringify({ interviewQuestions: [] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.loadOrCreateActiveInterviewContextSnapshot).not.toHaveBeenCalled();
  });

  it("blocks launching AI interview when the linked job disables it", async () => {
    mocks.loadResumeDetail.mockResolvedValue({
      ...EXISTING_RECORD,
      jobDescriptionAiInterviewDisabled: true,
    });

    const response = await makeApp().request(`/resumes/${RECORD_ID}/launch-interview`, {
      body: JSON.stringify({ interviewQuestions: [] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "当前关联岗位已禁用 AI 面试。",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("exposes workspace review data and records a one-time evaluation", async () => {
    mocks.loadResumeDetailForAuthenticatedReviewer
      .mockResolvedValueOnce({ id: RECORD_ID })
      .mockResolvedValueOnce({ id: RECORD_ID })
      .mockResolvedValueOnce({ id: RECORD_ID, resumeEvaluationStatus: "pass" });
    mocks.submitResumeEvaluationOnce.mockResolvedValue({ status: "updated" });

    const detailResponse = await makeApp().request(`/resumes/${RECORD_ID}/review`);
    const evaluationResponse = await makeApp().request(`/resumes/${RECORD_ID}/review/evaluation`, {
      body: JSON.stringify({
        availableTimeSlots: [
          { endAt: "2026-07-12T11:00:00.000Z", startAt: "2026-07-12T10:00:00.000Z" },
        ],
        reason: "符合岗位要求",
        status: "pass",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(detailResponse.status).toBe(200);
    expect(evaluationResponse.status).toBe(200);
    expect(mocks.submitResumeEvaluationOnce).toHaveBeenCalledWith({
      availableTimeSlots: [
        { endAt: "2026-07-12T11:00:00.000Z", startAt: "2026-07-12T10:00:00.000Z" },
      ],
      id: RECORD_ID,
      operatorId: USER_ID,
      organizationId: ORGANIZATION_ID,
      reason: "符合岗位要求",
      status: "pass",
    });
  });

  it("audits a job change while preserving fork fields and invalidating stale AI assessment", async () => {
    const existingWithProfile = {
      ...EXISTING_RECORD,
      resumeProfile: { name: "候选人", targetRoles: [] },
    };
    mocks.loadResumeDetail
      .mockResolvedValueOnce(existingWithProfile)
      .mockResolvedValueOnce({ ...existingWithProfile, jobDescriptionId: "jd-new" });
    mocks.loadJobDescriptionById.mockResolvedValue({ id: "jd-new", name: "新岗位" });

    const formData = new FormData();
    formData.set("candidateEmail", "");
    formData.set("candidateName", "候选人");
    formData.set("candidatePhone", "");
    formData.set("hiringUnitId", "unit-1");
    formData.set("hrResumeAssessment", "建议进入下一轮");
    formData.set("jobDescriptionId", "jd-new");
    formData.set("notes", "不应覆盖已有简历评价");
    formData.set("recommendationText", "推荐给业务负责人");
    formData.set("resumeEvaluationStatus", "pass");
    formData.set("resumeReview", "invalid-json-that-must-be-ignored");
    formData.set("targetRole", "");

    const response = await makeApp().request(`/resumes/${RECORD_ID}`, {
      body: formData,
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        hiringUnitId: "unit-1",
        hrResumeAssessment: "建议进入下一轮",
        notes: null,
        recommendationText: "推荐给业务负责人",
        resumeReview: null,
      }),
    );
    const [updatePatch] = mocks.updatePatches;
    expect(updatePatch).not.toHaveProperty("resumeStorageKey");
    expect(mocks.applyJobDescriptionChangeEffects).toHaveBeenCalledWith(expect.any(Object), {
      interviewRecordId: RECORD_ID,
      nextJobDescriptionId: "jd-new",
      nextJobDescriptionName: "新岗位",
      operatorId: USER_ID,
      organizationId: ORGANIZATION_ID,
      previousEvaluationStatus: "pass",
      previousJobDescriptionId: "jd-old",
      previousJobDescriptionName: "旧岗位",
    });
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        closedAt: null,
        closedMeta: null,
        closedReason: null,
        outcome: "in_pipeline",
        pipelineStage: "screening",
      }),
    );
    expect(mocks.enqueueResumeReassessmentForRecord).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      resumeRecordId: RECORD_ID,
    });
  });

  it("restarts a later-stage candidate at screening when rebinding to an AI-disabled job", async () => {
    mocks.loadResumeDetail.mockResolvedValue({
      ...EXISTING_RECORD,
      pipelineStage: "human_interview",
    });
    mocks.loadJobDescriptionById.mockResolvedValue({
      aiInterviewDisabled: true,
      id: "jd-new",
      name: "线下面试岗位",
    });

    const formData = new FormData();
    formData.set("candidateEmail", "");
    formData.set("candidateName", "候选人");
    formData.set("candidatePhone", "");
    formData.set("hiringUnitId", "unit-1");
    formData.set("hrResumeAssessment", "");
    formData.set("jobDescriptionId", "jd-new");
    formData.set("recommendationText", "");
    formData.set("resumeEvaluationStatus", "pass");
    formData.set("targetRole", "");

    const response = await makeApp().request(`/resumes/${RECORD_ID}`, {
      body: formData,
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        outcome: "in_pipeline",
        pipelineStage: "screening",
      }),
    );
    expect(mocks.applyJobDescriptionChangeEffects).toHaveBeenCalled();
  });

  it("invalidates stale AI scoring and queues a new assessment when the job changes", async () => {
    const processingRecord = {
      ...EXISTING_RECORD,
      resumeProfile: { name: "候选人", targetRoles: [] },
      resumeReview: { overall: { conclusion: "旧岗位评分" } },
      resumeReviewRunId: "old-run",
      resumeReviewStatus: "processing",
      resumeScreeningResult: { recommendation: "pass" },
      resumeScreeningStatus: "processing",
    };
    mocks.loadResumeDetail.mockResolvedValueOnce(processingRecord).mockResolvedValueOnce({
      ...processingRecord,
      jobDescriptionId: "jd-new",
      resumeReview: null,
      resumeReviewStatus: "queued",
    });
    mocks.loadJobDescriptionById.mockResolvedValue({ id: "jd-new", name: "新岗位" });

    const response = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: null,
        candidateEmail: "",
        candidateName: "候选人",
        candidatePhone: "",
        gender: "",
        hiringUnitId: "unit-1",
        jobDescriptionId: "jd-new",
        recommendationText: "",
        resumeEvaluationStatus: "pass",
        targetRole: "",
        workYears: null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        resumeReview: null,
        resumeReviewError: null,
        resumeReviewGeneratedAt: null,
        resumeReviewQueuedAt: null,
        resumeReviewRunId: null,
        resumeReviewStatus: "idle",
        resumeScreeningError: null,
        resumeScreeningEvaluatedAt: null,
        resumeScreeningResult: null,
        resumeScreeningStatus: "idle",
      }),
    );
    expect(mocks.enqueueResumeReassessmentForRecord).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      resumeRecordId: RECORD_ID,
    });
    expect(mocks.applyJobDescriptionChangeEffects).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        interviewRecordId: RECORD_ID,
        operatorId: USER_ID,
        organizationId: ORGANIZATION_ID,
      }),
    );
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        outcome: "in_pipeline",
        pipelineStage: "screening",
      }),
    );
  });

  it("updates overview identity fields without overwriting fork-only resume fields", async () => {
    mocks.loadResumeDetail
      .mockResolvedValueOnce(EXISTING_RECORD)
      .mockResolvedValueOnce({ ...EXISTING_RECORD, candidateName: "新候选人" });

    const response = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: 31,
        candidateEmail: "new@example.com",
        candidateName: "新候选人",
        candidatePhone: "13900000000",
        gender: "女",
        hiringUnitId: "unit-2",
        jobDescriptionId: "jd-old",
        recommendationText: "推荐给业务负责人",
        resumeEvaluationStatus: "pass",
        targetRole: "后端工程师",
        workYears: 8.5,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        candidateEmail: "new@example.com",
        candidateName: "新候选人",
        candidatePhone: "13900000000",
        hiringUnitId: "unit-2",
        jobDescriptionId: "jd-old",
        recommendationText: "推荐给业务负责人",
        targetRole: "后端工程师",
      }),
    );
    const [updatePatch] = mocks.updatePatches;
    expect(updatePatch).not.toHaveProperty("hrResumeAssessment");
    expect(updatePatch).toHaveProperty("recommendationText", "推荐给业务负责人");
  });

  it("updates a recommendation for a legacy record without a job or hiring unit", async () => {
    const legacyRecord = {
      ...EXISTING_RECORD,
      hiringUnitId: null,
      jobDescriptionId: null,
      jobDescriptionName: null,
    };
    mocks.loadResumeDetail
      .mockResolvedValueOnce(legacyRecord)
      .mockResolvedValueOnce({ ...legacyRecord, recommendationText: "推荐给业务负责人" });

    const response = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: null,
        candidateEmail: "",
        candidateName: "候选人",
        candidatePhone: "",
        gender: "",
        hiringUnitId: null,
        jobDescriptionId: null,
        recommendationText: "推荐给业务负责人",
        resumeEvaluationStatus: "pass",
        targetRole: "",
        workYears: null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.jobDescriptionIdsExist).not.toHaveBeenCalled();
    expect(mocks.loadHiringUnitById).not.toHaveBeenCalled();
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        hiringUnitId: null,
        jobDescriptionId: null,
        recommendationText: "推荐给业务负责人",
      }),
    );
  });

  it("does not let overview quick edit clear an existing job or hiring unit", async () => {
    mocks.loadResumeDetail.mockResolvedValue(EXISTING_RECORD);

    const clearJobResponse = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: null,
        candidateEmail: "",
        candidateName: "候选人",
        candidatePhone: "",
        gender: "",
        hiringUnitId: "unit-1",
        jobDescriptionId: null,
        recommendationText: "",
        resumeEvaluationStatus: "pass",
        targetRole: "",
        workYears: null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(clearJobResponse.status).toBe(400);
    await expect(clearJobResponse.json()).resolves.toEqual({ error: "请选择关联在招岗位。" });

    const clearHiringUnitResponse = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: null,
        candidateEmail: "",
        candidateName: "候选人",
        candidatePhone: "",
        gender: "",
        hiringUnitId: null,
        jobDescriptionId: "jd-old",
        recommendationText: "",
        resumeEvaluationStatus: "pass",
        targetRole: "",
        workYears: null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(clearHiringUnitResponse.status).toBe(400);
    await expect(clearHiringUnitResponse.json()).resolves.toEqual({ error: "请选择用人组织。" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an overview hiring unit outside the active organization", async () => {
    mocks.loadResumeDetail.mockResolvedValue(EXISTING_RECORD);
    mocks.loadHiringUnitById.mockResolvedValue(null);

    const response = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: 31,
        candidateEmail: "",
        candidateName: "候选人",
        candidatePhone: "",
        gender: "",
        hiringUnitId: "unit-other-org",
        jobDescriptionId: "jd-old",
        recommendationText: "",
        resumeEvaluationStatus: "pass",
        targetRole: "",
        workYears: 8,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "所选用人组织不存在。" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("allows overview quick edit to clear the target role", async () => {
    mocks.loadResumeDetail
      .mockResolvedValueOnce({ ...EXISTING_RECORD, targetRole: "旧目标岗位" })
      .mockResolvedValueOnce({ ...EXISTING_RECORD, targetRole: null });

    const response = await makeApp().request(`/resumes/${RECORD_ID}/identity`, {
      body: JSON.stringify({
        age: null,
        candidateEmail: "",
        candidateName: "候选人",
        candidatePhone: "",
        gender: "",
        hiringUnitId: "unit-1",
        jobDescriptionId: "jd-old",
        recommendationText: "",
        resumeEvaluationStatus: "pass",
        targetRole: "",
        workYears: null,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(mocks.updatePatches).toContainEqual(
      expect.objectContaining({
        recommendationText: null,
        targetRole: null,
      }),
    );
  });

  it("cleans semantic and duplicate state after deleting a resume", async () => {
    mocks.loadResumeDetail.mockResolvedValue(EXISTING_RECORD);
    mocks.deleteReturning.mockResolvedValue([{ id: RECORD_ID }]);

    const response = await makeApp().request(`/resumes/${RECORD_ID}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(mocks.deleteResumeSemanticIndexBestEffort).toHaveBeenCalledWith({
      sourceId: RECORD_ID,
      sourceType: "studio_interview",
    });
    expect(mocks.deleteDuplicateMatchesForSource).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      sourceId: RECORD_ID,
      sourceType: "studio_interview",
    });
    expect(mocks.removeImportedInterviewFromConversations).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      RECORD_ID,
    );
  });
});
