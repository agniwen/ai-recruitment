import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  checkConversationOwner: vi.fn(),
  confirmRecruitingAction: vi.fn(),
  createRequestWorkspaceAuthorizer: vi.fn(),
  loadResumeDetail: vi.fn(),
  loadResumePoolItem: vi.fn(),
  resolveHiringUnitAccessScope: vi.fn(),
  resolveResumeVisibilityScope: vi.fn(),
  upsertConversation: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer: mocks.createRequestWorkspaceAuthorizer,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  resolveResumeVisibilityScope: mocks.resolveResumeVisibilityScope,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope", () => ({
  resolveHiringUnitAccessScope: mocks.resolveHiringUnitAccessScope,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/resumes",
  () => ({
    loadResumeDetail: mocks.loadResumeDetail,
  }),
);
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-pool/dao", () => ({
  loadResumePoolItem: mocks.loadResumePoolItem,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/chat/dao/chat", () => ({
  checkConversationOwner: mocks.checkConversationOwner,
  deleteUserConversation: vi.fn(),
  getUserConversation: vi.fn(),
  listUserConversations: vi.fn(),
  upsertChatMessage: vi.fn(),
  upsertConversation: mocks.upsertConversation,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/chat/routes/conversations/actions",
  () => ({
    confirmRecruitingAction: mocks.confirmRecruitingAction,
  }),
);

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { conversationsRouter } from "@arc/ai-recruitment-copilot-backend/server/routes/chat/routes/conversations/route";

const USER_ID = "user_conversations_route";
const ORG_ID = "org_conversations_route";

function makeApp() {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("user", { id: USER_ID } as never);
      c.set("activeOrg", { id: ORG_ID } as never);
      await next();
    })
    .route("/conversations", conversationsRouter);
}

async function jsonOf(res: Response) {
  return (await res.json()) as { error?: unknown; ok?: boolean };
}

describe("conversationsRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRequestWorkspaceAuthorizer.mockReturnValue(mocks.authorize);
    mocks.authorize.mockResolvedValue(true);
    mocks.loadResumeDetail.mockResolvedValue({ id: "resume-1" });
    mocks.loadResumePoolItem.mockResolvedValue({ id: "pool-1" });
    mocks.resolveHiringUnitAccessScope.mockResolvedValue({
      canAccessAll: false,
      hiringUnitIds: ["hiring-unit-1"],
    });
    mocks.resolveResumeVisibilityScope.mockResolvedValue({
      odc: { departmentIds: [], hiringUnitIds: [] },
      recruiting: { kind: "all" },
    });
  });

  it("returns a normalized string error for invalid conversation create payloads", async () => {
    const res = await makeApp().request("/conversations", {
      body: JSON.stringify({ title: "missing id" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(400);
    const json = await jsonOf(res);
    expect(typeof json.error).toBe("string");
    expect(mocks.upsertConversation).not.toHaveBeenCalled();
  });

  it("returns explicit 200 responses for successful conversation writes", async () => {
    mocks.upsertConversation.mockResolvedValue({ id: "conversation_1" });

    const res = await makeApp().request("/conversations", {
      body: JSON.stringify({ id: "conversation_1", title: "新对话" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(200);
    await expect(jsonOf(res)).resolves.toEqual({ ok: true });
  });

  it("confirms recruiting actions only after conversation ownership is checked", async () => {
    mocks.checkConversationOwner.mockResolvedValue("ok");
    mocks.confirmRecruitingAction.mockResolvedValue({
      actionType: "bind_candidate_to_job",
      message: "已在本对话中将该候选人关联到所选岗位（仅影响本轮分析，未改招聘台数据）。",
      status: "executed",
    });

    const res = await makeApp().request("/conversations/conversation_1/actions/confirm", {
      body: JSON.stringify({
        proposal: {
          explanation: "候选人与岗位匹配。",
          id: "proposal-1",
          payload: {
            jobDescriptionId: "jd-1",
            resumeRecordId: "resume-1",
          },
          title: "绑定岗位",
          type: "bind_candidate_to_job",
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(mocks.checkConversationOwner).toHaveBeenCalledWith(USER_ID, "conversation_1", ORG_ID);
    expect(mocks.confirmRecruitingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        authorize: mocks.authorize,
        conversationId: "conversation_1",
        decision: "confirm",
        operatorId: USER_ID,
        organizationId: ORG_ID,
        visibilityScope: {
          odc: { departmentIds: [], hiringUnitIds: [] },
          recruiting: { kind: "all" },
        },
      }),
    );
    expect(mocks.authorize).toHaveBeenCalledWith({
      action: "update",
      resource: "resumeLibrary",
    });
    expect(mocks.authorize).toHaveBeenCalledWith({ action: "read", resource: "jd" });
    expect(mocks.resolveHiringUnitAccessScope).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
    });
    await expect(res.json()).resolves.toEqual({
      actionType: "bind_candidate_to_job",
      message: "已在本对话中将该候选人关联到所选岗位（仅影响本轮分析，未改招聘台数据）。",
      status: "executed",
    });
  });

  it("uses target pool, JD, visibility, and hiring-unit guards for pool binding", async () => {
    mocks.checkConversationOwner.mockResolvedValue("ok");
    mocks.confirmRecruitingAction.mockResolvedValue({
      actionType: "bind_pool_item_to_job",
      message: "已在本对话中将该简历池条目关联到所选岗位（仅影响本轮分析，未改简历池数据）。",
      status: "executed",
    });

    const res = await makeApp().request("/conversations/conversation_1/actions/confirm", {
      body: JSON.stringify({
        proposal: {
          explanation: "简历池候选人与岗位匹配。",
          id: "proposal-pool-1",
          payload: {
            jobDescriptionId: "jd-1",
            poolItemId: "pool:pool-1",
          },
          title: "绑定简历池岗位",
          type: "bind_pool_item_to_job",
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith({
      action: "import",
      resource: "resumePool",
    });
    expect(mocks.authorize).toHaveBeenCalledWith({ action: "read", resource: "jd" });
    expect(mocks.loadResumePoolItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      poolItemId: "pool-1",
      userId: USER_ID,
      visibilityScope: { kind: "all" },
    });
    expect(mocks.resolveHiringUnitAccessScope).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
    });
    expect(mocks.confirmRecruitingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation_1",
        decision: "confirm",
        hiringUnitScope: {
          canAccessAll: false,
          hiringUnitIds: ["hiring-unit-1"],
        },
        visibilityScope: {
          odc: { departmentIds: [], hiringUnitIds: [] },
          recruiting: { kind: "all" },
        },
      }),
    );
  });

  it("rejects pool binding before record lookup when pool import permission is missing", async () => {
    mocks.checkConversationOwner.mockResolvedValue("ok");
    mocks.authorize.mockImplementation(({ resource }: { resource: string }) =>
      Promise.resolve(resource !== "resumePool"),
    );

    const res = await makeApp().request("/conversations/conversation_1/actions/confirm", {
      body: JSON.stringify({
        proposal: {
          explanation: "简历池候选人与岗位匹配。",
          id: "proposal-pool-1",
          payload: {
            jobDescriptionId: "jd-1",
            poolItemId: "pool:pool-1",
          },
          title: "绑定简历池岗位",
          type: "bind_pool_item_to_job",
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(403);
    expect(mocks.loadResumePoolItem).not.toHaveBeenCalled();
    expect(mocks.confirmRecruitingAction).not.toHaveBeenCalled();
  });

  it("does not execute recruiting actions for conversations outside the workspace", async () => {
    mocks.checkConversationOwner.mockResolvedValue("forbidden");

    const res = await makeApp().request("/conversations/conversation_2/actions/confirm", {
      body: JSON.stringify({
        proposal: {
          explanation: "候选人与岗位匹配。",
          id: "proposal-1",
          payload: {
            jobDescriptionId: "jd-1",
            resumeRecordId: "resume-1",
          },
          title: "绑定岗位",
          type: "bind_candidate_to_job",
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(403);
    expect(mocks.confirmRecruitingAction).not.toHaveBeenCalled();
  });
});

it("persists ignore after RBAC and ownership checks without loading candidate data", async () => {
  mocks.checkConversationOwner.mockResolvedValue("ok");
  mocks.confirmRecruitingAction.mockResolvedValue({
    actionType: "bind_candidate_to_job",
    confirmation: {
      confirmedAt: "2026-07-24T00:00:00.000Z",
      status: "ignored",
    },
    message: "已忽略该动作建议。",
    status: "executed",
  });

  const res = await makeApp().request("/conversations/conversation_1/actions/confirm", {
    body: JSON.stringify({
      decision: "ignore",
      proposal: {
        explanation: "候选人与岗位匹配。",
        id: "conversation-bind:resume_record:resume-1",
        payload: {
          resumeRecordId: "resume-1",
        },
        title: "关联岗位",
        type: "bind_candidate_to_job",
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(res.status).toBe(200);
  expect(mocks.authorize).toHaveBeenCalledWith({
    action: "update",
    resource: "resumeLibrary",
  });
  expect(mocks.authorize).toHaveBeenCalledWith({ action: "read", resource: "jd" });
  expect(mocks.loadResumeDetail).not.toHaveBeenCalled();
  expect(mocks.resolveHiringUnitAccessScope).not.toHaveBeenCalled();
  expect(mocks.confirmRecruitingAction).toHaveBeenCalledWith(
    expect.objectContaining({
      conversationId: "conversation_1",
      decision: "ignore",
      hiringUnitScope: null,
    }),
  );
});
