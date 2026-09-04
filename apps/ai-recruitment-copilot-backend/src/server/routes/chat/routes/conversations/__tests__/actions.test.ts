import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadJobDescriptionById: vi.fn(),
  loadResumeDetail: vi.fn(),
  loadResumePoolItem: vi.fn(),
  patchRecruitingActionConfirmationInConversation: vi.fn(),
  upsertConversationContextJobBinding: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {},
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao",
  () => ({
    loadJobDescriptionById: mocks.loadJobDescriptionById,
  }),
);

vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-pool/dao", () => ({
  loadResumePoolItem: mocks.loadResumePoolItem,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/resumes",
  () => ({
    loadResumeDetail: mocks.loadResumeDetail,
  }),
);

vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/chat/dao/chat", () => ({
  patchRecruitingActionConfirmationInConversation:
    mocks.patchRecruitingActionConfirmationInConversation,
  upsertConversationContextJobBinding: mocks.upsertConversationContextJobBinding,
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { confirmRecruitingAction } from "../actions";

describe("confirmRecruitingAction bind_* conversation context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadJobDescriptionById.mockResolvedValue({ id: "jd-1", name: "前端工程师" });
    mocks.loadResumeDetail.mockResolvedValue({ id: "resume-1" });
    mocks.loadResumePoolItem.mockResolvedValue({
      id: "pool-1",
      jobDescriptionId: null,
    });
    mocks.upsertConversationContextJobBinding.mockResolvedValue({
      previousJobDescriptionId: null,
      status: "updated",
    });
    mocks.patchRecruitingActionConfirmationInConversation.mockResolvedValue(1);
  });

  it("stores resume-record bind as a chat message binding", async () => {
    const result = await confirmRecruitingAction({
      authorize: vi.fn() as never,
      conversationId: "conversation-1",
      hiringUnitScope: {
        canAccessAll: false,
        canAccessPublic: true,
        departmentIds: [],
        hiringUnitIds: ["hiring-unit-1"],
      },
      operatorId: "user-1",
      operatorRole: "odc",
      organizationId: "org-1",
      proposal: {
        explanation: "先按前端岗位分析。",
        id: "proposal-1",
        payload: {
          jobDescriptionId: "jd-1",
          resumeRecordId: "resume-1",
        },
        title: "关联岗位",
        type: "bind_candidate_to_job",
      },
      visibilityScope: { kind: "all" },
    });

    expect(mocks.loadJobDescriptionById).toHaveBeenCalledWith("org-1", "jd-1", {
      actorUserId: "user-1",
    });
    expect(mocks.loadResumeDetail).toHaveBeenCalledWith("resume-1", "org-1", { kind: "all" });
    expect(mocks.upsertConversationContextJobBinding).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      jobDescriptionId: "jd-1",
      jobDescriptionName: "前端工程师",
      kind: "resume_record",
      organizationId: "org-1",
      recordId: "resume-1",
      summaryText: expect.stringContaining("前端工程师"),
    });
    expect(mocks.patchRecruitingActionConfirmationInConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation: expect.objectContaining({
          jobDescriptionId: "jd-1",
          jobDescriptionName: "前端工程师",
          status: "confirmed",
        }),
        conversationId: "conversation-1",
        proposalId: "proposal-1",
      }),
    );
    expect(result.status).toBe("executed");
    expect(result).toMatchObject({
      actionType: "bind_candidate_to_job",
      confirmation: expect.objectContaining({
        jobDescriptionId: "jd-1",
        status: "confirmed",
      }),
      message: "已在本对话中将该候选人关联到所选岗位（仅影响本轮分析，未改招聘台数据）。",
    });
  });

  it("stores pool-item bind as a chat message binding", async () => {
    const result = await confirmRecruitingAction({
      authorize: vi.fn() as never,
      conversationId: "conversation-1",
      hiringUnitScope: {
        canAccessAll: false,
        canAccessPublic: true,
        departmentIds: [],
        hiringUnitIds: ["hiring-unit-1"],
      },
      operatorId: "user-1",
      operatorRole: "odc",
      organizationId: "org-1",
      proposal: {
        explanation: "先按前端岗位分析。",
        id: "proposal-2",
        payload: {
          jobDescriptionId: "jd-1",
          poolItemId: "pool:pool-1",
        },
        title: "关联岗位",
        type: "bind_pool_item_to_job",
      },
      visibilityScope: { kind: "all" },
    });

    expect(mocks.upsertConversationContextJobBinding).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      jobDescriptionId: "jd-1",
      jobDescriptionName: "前端工程师",
      kind: "resume_pool_item",
      organizationId: "org-1",
      recordId: "pool-1",
      summaryText: expect.stringContaining("前端工程师"),
    });
    expect(mocks.loadResumePoolItem).toHaveBeenCalledWith({
      organizationId: "org-1",
      poolItemId: "pool-1",
      userId: "user-1",
      visibilityScope: { kind: "all" },
    });
    expect(result.status).toBe("executed");
    expect(result).toMatchObject({
      actionType: "bind_pool_item_to_job",
      confirmation: expect.objectContaining({
        jobDescriptionId: "jd-1",
        status: "confirmed",
      }),
      message: "已在本对话中将该简历池条目关联到所选岗位（仅影响本轮分析，未改简历池数据）。",
    });
  });

  it("persists ignore decision into tool JSON without writing a job binding", async () => {
    const result = await confirmRecruitingAction({
      authorize: vi.fn() as never,
      conversationId: "conversation-1",
      decision: "ignore",
      hiringUnitScope: null,
      operatorId: "user-1",
      operatorRole: "odc",
      organizationId: "org-1",
      proposal: {
        explanation: "先选岗位。",
        id: "conversation-bind:resume_record:resume-1",
        payload: {
          resumeRecordId: "resume-1",
        },
        title: "关联岗位",
        type: "bind_candidate_to_job",
      },
      visibilityScope: { kind: "all" },
    });

    expect(mocks.upsertConversationContextJobBinding).not.toHaveBeenCalled();
    expect(mocks.patchRecruitingActionConfirmationInConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation: expect.objectContaining({ status: "ignored" }),
        proposalId: "conversation-bind:resume_record:resume-1",
      }),
    );
    expect(result).toMatchObject({
      actionType: "bind_candidate_to_job",
      confirmation: expect.objectContaining({ status: "ignored" }),
      status: "executed",
    });
  });

  it("rejects a job outside the operator hiring-unit scope without persisting context", async () => {
    mocks.loadJobDescriptionById.mockResolvedValue(null);

    const result = await confirmRecruitingAction({
      authorize: vi.fn() as never,
      conversationId: "conversation-1",
      hiringUnitScope: {
        canAccessAll: false,
        canAccessPublic: true,
        departmentIds: [],
        hiringUnitIds: ["hiring-unit-1"],
      },
      operatorId: "user-1",
      operatorRole: "odc",
      organizationId: "org-1",
      proposal: {
        explanation: "先按其他招聘组的岗位分析。",
        id: "proposal-3",
        payload: {
          jobDescriptionId: "jd-other-unit",
          resumeRecordId: "resume-1",
        },
        title: "关联岗位",
        type: "bind_candidate_to_job",
      },
      visibilityScope: { kind: "all" },
    });

    expect(result).toEqual({
      message: "岗位不存在或不在当前招聘组负责的用人组织范围内。",
      status: "failed",
    });
    expect(mocks.upsertConversationContextJobBinding).not.toHaveBeenCalled();
    expect(mocks.patchRecruitingActionConfirmationInConversation).not.toHaveBeenCalled();
  });
});
