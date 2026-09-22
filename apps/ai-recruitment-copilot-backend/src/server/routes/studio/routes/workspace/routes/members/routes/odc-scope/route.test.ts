import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memberOdcScopeRouter } from "./route";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("./dao", () => ({ updateMemberOdcScope: mocks.update }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  safeUpdateTag: vi.fn(),
}));

function request(role: string, input: unknown) {
  const app = new Hono<{ Variables: { activeOrg: { id: string }; member: { role: string } } }>()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org" });
      c.set("member", { role });
      await next();
    })
    .route("/members/:memberId/odc-scope", memberOdcScopeRouter);
  return app.request("/members/m/odc-scope", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

beforeEach(() => {
  mocks.update.mockReset();
  mocks.update.mockResolvedValue("updated");
});
describe("member ODC scope API", () => {
  const all = { odcAssignments: [], odcScopeMode: "all" };
  it.each(["admin", "owner"])(
    "allows %s and binds writes to the request workspace",
    async (role) => {
      await expect(request(role, all)).resolves.toHaveProperty("status", 200);
      expect(mocks.update).toHaveBeenCalledWith("org", "m", all);
    },
  );
  it.each(["member", "odc", "noAccess"])("rejects %s before querying or writing", async (role) => {
    await expect(request(role, all)).resolves.toHaveProperty("status", 403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([
    { ...all, odcScopeMode: "everything" },
    {
      odcAssignments: [{ resumeSourceId: "a" }, { resumeSourceId: "a" }],
      odcScopeMode: "selected",
    },
  ])("rejects invalid or duplicate scope input", async (input) => {
    await expect(request("admin", input)).resolves.toHaveProperty("status", 400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each([
    ["not_found", 404],
    ["not_odc", 400],
    ["invalid_source", 400],
  ])("maps %s to a safe API error", async (result, status) => {
    mocks.update.mockResolvedValue(result);
    await expect(request("admin", all)).resolves.toHaveProperty("status", status);
  });
});
