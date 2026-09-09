import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiReviewRouter } from "./route";

const mocks = vi.hoisted(() => ({
  canApprove: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  scope: vi.fn(),
  transition: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission:
    (resource: string, action: string): MiddlewareHandler =>
    async (c, next) => {
      if (c.req.header(`x-permission-${resource}-${action}`) !== "yes") {
        return c.json({ error: "Forbidden" }, 403);
      }
      await next();
    },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  resolveResumeVisibilityScope: mocks.scope,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer: () => vi.fn(),
}));
vi.mock("../resumes/dao/resumes", () => ({
  loadResumeDetail: mocks.detail,
  queryPaginatedResumeRecords: mocks.list,
}));
vi.mock("../interviews/dao/ai-review-approval", () => ({
  canApproveCandidateAiReview: mocks.canApprove,
}));
vi.mock("../interviews/utils/candidate-stage-transition", () => ({
  transitionCandidateStage: mocks.transition,
}));

function request(
  path: string,
  options: { method?: string; page?: boolean; read?: boolean; body?: unknown } = {},
) {
  const app = new Hono<{
    Variables: { activeOrg: { id: string }; user: { id: string }; member: { role: string } };
  }>()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org-a" });
      c.set("user", { id: "odc-a" });
      c.set("member", { role: "odc" });
      await next();
    })
    .route("/ai-review", aiReviewRouter);
  return app.request(`/ai-review${path}`, {
    body:
      options.method === "POST"
        ? JSON.stringify(options.body ?? { approvalNote: "  已核实项目经验  " })
        : undefined,
    headers: {
      "content-type": "application/json",
      "x-permission-aiReview-read": options.read === false ? "no" : "yes",
      "x-permission-page-aiReview": options.page === false ? "no" : "yes",
    },
    method: options.method ?? "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scope.mockResolvedValue({
    odc: { resumeSourceIds: ["source-a"] },
    recruiting: { kind: "none" },
  });
  mocks.list.mockResolvedValue({ records: [], total: 0 });
  mocks.detail.mockResolvedValue({
    id: "candidate-a",
    jobDescriptionId: "jd-a",
    pipelineStage: "ai_review",
  });
  mocks.canApprove.mockResolvedValue(true);
  mocks.transition.mockResolvedValue({ kind: "ok" });
});

describe("AI analysis approval API", () => {
  it.each([{}, { approvalNote: "   " }, { approvalNote: "字".repeat(2001) }])(
    "rejects invalid explanations",
    async (body) => {
      const response = await request("/candidate-a/approve", { body, method: "POST" });
      expect(response.status).toBe(400);
      expect(mocks.transition).not.toHaveBeenCalled();
    },
  );
  it.each(["", "/candidate-a", "/candidate-a/approve"])(
    "requires both page and read permissions for %s",
    async (path) => {
      const method = path.endsWith("approve") ? "POST" : "GET";
      await expect(request(path, { method, page: false })).resolves.toHaveProperty("status", 403);
      await expect(request(path, { method, read: false })).resolves.toHaveProperty("status", 403);
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.detail).not.toHaveBeenCalled();
      expect(mocks.transition).not.toHaveBeenCalled();
    },
  );
  it("fixes the queue stage and respects workspace visibility even with forged filters", async () => {
    await expect(
      request("?pipelineStages=offer&candidateName=Alice&page=2&pageSize=10"),
    ).resolves.toHaveProperty("status", 200);
    expect(mocks.scope).toHaveBeenCalledWith({
      currentRole: "odc",
      organizationId: "org-a",
      userId: "odc-a",
    });
    expect(mocks.list).toHaveBeenCalledWith(
      "org-a",
      { candidateName: "Alice", outcomes: ["in_pipeline"], pipelineStages: ["ai_review"] },
      { page: 2, pageSize: 10, sortBy: "createdAt", sortOrder: "asc" },
      await mocks.scope.mock.results[0].value,
    );
  });
  it.each([null, { id: "candidate-a", pipelineStage: "screening" }])(
    "does not expose or approve invisible/already processed records",
    async (record) => {
      mocks.detail.mockResolvedValue(record);
      await expect(request("/candidate-a")).resolves.toHaveProperty("status", 404);
      await expect(request("/candidate-a/approve", { method: "POST" })).resolves.toHaveProperty(
        "status",
        404,
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    },
  );
  it("exposes source approval permission separately from page access", async () => {
    mocks.canApprove.mockResolvedValue(false);
    const response = await request("/candidate-a");
    expect(await response.json()).toMatchObject({ canApproveAiReview: false });
  });
  it("approves using the authenticated ODC and shared stage transition", async () => {
    await expect(request("/candidate-a/approve", { method: "POST" })).resolves.toHaveProperty(
      "status",
      200,
    );
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: "candidate-a",
        input: { approvalNote: "已核实项目经验", pipelineStage: "screening" },
        operatorId: "odc-a",
        operatorRole: "odc",
        organizationId: "org-a",
      }),
    );
  });
  it.each([
    ["forbidden", 403],
    ["invalid", 409],
  ] as const)("returns %s from the authoritative approval checks", async (kind, status) => {
    mocks.transition.mockResolvedValue({ kind, message: "请等待 AI 评价生成完成后再审批。" });
    await expect(request("/candidate-a/approve", { method: "POST" })).resolves.toHaveProperty(
      "status",
      status,
    );
  });
});
