import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobDescriptionReferenceOptionsRouter } from "../routes/reference-options/route";
import { jobDescriptionLinkedTemplatesRouter } from "../routes/linked-templates/route";
import { departmentReferenceOptionsRouter } from "../../departments/routes/reference-options/route";

const mocks = vi.hoisted(() => ({
  forms: vi.fn(),
  job: vi.fn(),
  permissions: new Set<string>(),
  questions: vi.fn(),
  sources: vi.fn(),
  units: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission:
    (resource: string, action: string): MiddlewareHandler =>
    async (c, next) => {
      if (!mocks.permissions.has(`${resource}:${action}`)) {
        return c.json({ message: "Forbidden" }, 403);
      }
      await next();
    },
}));
vi.mock("../resume-source", () => ({ listSelectableResumeSources: mocks.sources }));
vi.mock("../dao", () => ({ loadJobDescriptionById: mocks.job }));
vi.mock("../../hiring-units/dao", () => ({ listSelectableHiringUnits: mocks.units }));
vi.mock("../../forms/dao/queries", () => ({ queryPaginatedCandidateFormTemplates: mocks.forms }));
vi.mock("../../interview-questions/dao/queries", () => ({
  queryPaginatedInterviewQuestionTemplates: mocks.questions,
}));
function app() {
  return new Hono<{ Variables: { activeOrg: { id: string }; user: { id: string } } }>()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "work" });
      c.set("user", { id: "odc" });
      await next();
    })
    .route("/jobs/reference-options", jobDescriptionReferenceOptionsRouter)
    .route("/jobs/:id/linked-templates", jobDescriptionLinkedTemplatesRouter)
    .route("/departments/reference-options", departmentReferenceOptionsRouter);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set([
    "page:jobDescriptions",
    "jd:read",
    "page:departments",
    "department:read",
  ]);
  mocks.sources.mockResolvedValue([{ id: "s", name: "来源" }]);
  mocks.units.mockResolvedValue([{ description: "internal", id: "u", name: "用人组织" }]);
  mocks.job.mockResolvedValue({ id: "job" });
  const template = {
    description: null,
    id: "t",
    jobDescriptions: ["unrelated"],
    questionCount: 2,
    submissionCount: 99,
    title: "题目",
  };
  mocks.forms.mockResolvedValue({ records: [template] });
  mocks.questions.mockResolvedValue({ records: [template] });
});
describe("page-owned reference permissions", () => {
  it("allows scoped source choices with job access and no source management access", async () => {
    const response = await app().request("/jobs/reference-options");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records: [{ id: "s", name: "来源" }] });
    expect(mocks.sources).toHaveBeenCalledWith({ actorUserId: "odc", organizationId: "work" });
  });
  it("allows minimal unit choices with department access and no hiring-unit access", async () => {
    const response = await app().request("/departments/reference-options");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records: [{ id: "u", name: "用人组织" }] });
    expect(mocks.units).toHaveBeenCalledWith({ actorUserId: "odc", organizationId: "work" });
  });
  it.each(["page:jobDescriptions", "jd:read"])(
    "rejects job lookups without %s",
    async (permission) => {
      mocks.permissions.delete(permission);
      await expect(app().request("/jobs/reference-options")).resolves.toHaveProperty("status", 403);
      await expect(app().request("/jobs/job/linked-templates")).resolves.toHaveProperty(
        "status",
        403,
      );
      expect(mocks.sources).not.toHaveBeenCalled();
      expect(mocks.forms).not.toHaveBeenCalled();
    },
  );
  it.each(["page:departments", "department:read"])(
    "rejects department lookups without %s",
    async (permission) => {
      mocks.permissions.delete(permission);
      await expect(app().request("/departments/reference-options")).resolves.toHaveProperty(
        "status",
        403,
      );
      expect(mocks.units).not.toHaveBeenCalled();
    },
  );
  it("returns only summaries linked to an accessible job without requiring template management", async () => {
    const response = await app().request("/jobs/job/linked-templates");
    expect(response.status).toBe(200);
    expect(mocks.job).toHaveBeenCalledWith("work", "job", { actorUserId: "odc" });
    const summary = [{ description: null, id: "t", questionCount: 2, title: "题目" }];
    expect(await response.json()).toEqual({ forms: summary, interviewQuestions: summary });
    for (const query of [mocks.forms, mocks.questions]) {
      expect(query).toHaveBeenCalledWith(
        "work",
        { archivedFilter: "active", jobDescriptionId: "job" },
        expect.any(Object),
      );
    }
  });
  it("rejects a foreign or inaccessible job before reading templates", async () => {
    mocks.job.mockResolvedValue(null);
    await expect(app().request("/jobs/foreign/linked-templates")).resolves.toHaveProperty(
      "status",
      404,
    );
    expect(mocks.forms).not.toHaveBeenCalled();
    expect(mocks.questions).not.toHaveBeenCalled();
  });
});
