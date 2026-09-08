import { resumeSourceOdcRouter } from "./route";
import { hiringUnitOdcRouter } from "../../../hiring-units/routes/odc/route";
import { departmentOdcRouter } from "../../../departments/routes/odc/route";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MiddlewareHandler } from "hono";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  eligible: vi.fn(),
  list: vi.fn(),
  load: vi.fn(),
  remove: vi.fn(),
  replace: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: (): MiddlewareHandler => async (c, next) => {
    if (c.req.header("x-test-permission") !== "allowed") {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  safeUpdateTag: vi.fn(),
}));
vi.mock("../../../hiring-units/odc-assignment", () => ({ areEligibleOdcMembers: mocks.eligible }));
vi.mock("../../dao", () => ({ loadResumeSourceById: mocks.load }));
vi.mock("./dao", () => ({
  createResumeSourceOdcAssignment: mocks.create,
  deleteResumeSourceOdcAssignment: mocks.remove,
  queryPaginatedResumeSourceOdcAssignments: mocks.list,
  replaceResumeSourceOdcMembers: mocks.replace,
  updateResumeSourceOdcAssignment: mocks.update,
}));

function app() {
  return new Hono<{ Variables: { activeOrg: { id: string } } }>()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org-a" });
      await next();
    })
    .route("/sources/:id/odc", resumeSourceOdcRouter)
    .route("/units/:id/odc", hiringUnitOdcRouter)
    .route("/departments/:id/odc", departmentOdcRouter);
}
function request(path: string, body: unknown, method = "PUT", permitted = true) {
  return app().request(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-test-permission": permitted ? "allowed" : "denied",
    },
    method,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.eligible.mockResolvedValue(true);
  mocks.replace.mockResolvedValue(true);
  mocks.load.mockResolvedValue({ id: "source-a" });
});
describe("resume source ODC boundary", () => {
  it("saves member scopes on the source in the current workspace", async () => {
    const assignments = [{ jobSeries: "直属", memberId: "member-a", serviceUnit: "悦达" }];
    await expect(request("/sources/source-a/odc", { assignments })).resolves.toHaveProperty(
      "status",
      200,
    );
    expect(mocks.eligible).toHaveBeenCalledWith({
      memberIds: ["member-a"],
      organizationId: "org-a",
    });
    expect(mocks.replace).toHaveBeenCalledWith({
      assignments,
      id: "source-a",
      organizationId: "org-a",
    });
  });
  it("supports clearing all assignments", async () => {
    await expect(request("/sources/source-a/odc", { assignments: [] })).resolves.toHaveProperty(
      "status",
      200,
    );
    expect(mocks.replace).toHaveBeenCalledWith({
      assignments: [],
      id: "source-a",
      organizationId: "org-a",
    });
  });
  it("rejects duplicate members before writing", async () => {
    await expect(
      request("/sources/source-a/odc", { assignments: [{ memberId: "m" }, { memberId: "m" }] }),
    ).resolves.toHaveProperty("status", 400);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("rejects members outside the workspace or without an ODC role", async () => {
    mocks.eligible.mockResolvedValue(false);
    await expect(
      request("/sources/source-a/odc", { assignments: [{ memberId: "other" }] }),
    ).resolves.toHaveProperty("status", 400);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("does not update missing or foreign-workspace sources", async () => {
    mocks.replace.mockResolvedValue(false);
    await expect(request("/sources/foreign/odc", { assignments: [] })).resolves.toHaveProperty(
      "status",
      404,
    );
  });
  it("requires update permission", async () => {
    await expect(
      request("/sources/source-a/odc", { assignments: [] }, "PUT", false),
    ).resolves.toHaveProperty("status", 403);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it.each(["units", "departments"])(
    "retires every legacy write method for %s",
    async (resource) => {
      for (const method of ["PUT", "POST", "PATCH", "DELETE"]) {
        const suffix = method === "PATCH" || method === "DELETE" ? "/member-a" : "";
        await expect(request(`/${resource}/old/odc${suffix}`, {}, method)).resolves.toHaveProperty(
          "status",
          410,
        );
      }
    },
  );
});
