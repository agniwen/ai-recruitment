import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { jobMatchingIndexRouter } from "./route";

const mocks = vi.hoisted(() => ({ rebuild: vi.fn(), status: vi.fn() }));
vi.mock("./utils", () => ({
  getJobMatchingIndexStatus: mocks.status,
  startJobMatchingIndexRebuild: mocks.rebuild,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ total: 2, vectorPoints: 0 });
  mocks.rebuild.mockResolvedValue({ queued: 2 });
});
function app(role: string | null = "admin") {
  const instance = new Hono<{
    Variables: { activeOrg: { id: string }; user: { id: string; role: string } | null };
  }>();
  instance.use("*", async (c, next) => {
    c.set("activeOrg", { id: "requested-workspace" });
    c.set("user", role ? { id: "operator", role } : null);
    await next();
  });
  return instance.route("/index", jobMatchingIndexRouter);
}
it.each(["user", "owner", null])(
  "rejects non-platform account role %s before reading or rebuilding",
  async (role) => {
    const read = await app(role).request("/index");
    const rebuild = await app(role).request("/index/rebuild", { method: "POST" });
    const retry = await app(role).request("/index/retry-failed", { method: "POST" });
    expect(read.status).toBe(role ? 403 : 401);
    expect(rebuild.status).toBe(role ? 403 : 401);
    expect(retry.status).toBe(role ? 403 : 401);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.rebuild).not.toHaveBeenCalled();
  },
);
it("uses only the workspace resolved by the authenticated request", async () => {
  const read = await app().request("/index?organizationId=foreign");
  expect(read.status).toBe(200);
  expect(mocks.status).toHaveBeenCalledWith("requested-workspace");
  const rebuild = await app().request("/index/rebuild", { method: "POST" });
  expect(rebuild.status).toBe(202);
  expect(await rebuild.json()).toEqual({ queued: 2 });
  expect(mocks.rebuild).toHaveBeenCalledWith("requested-workspace");
});
it("retries only failed jobs using the authenticated workspace", async () => {
  const response = await app().request("/index/retry-failed?organizationId=foreign", {
    method: "POST",
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ queued: 2 });
  expect(mocks.rebuild).toHaveBeenCalledWith("requested-workspace", { failedOnly: true });
});
it("reports retry enqueue failures without claiming completion", async () => {
  mocks.rebuild.mockRejectedValue(new Error("queue unavailable"));
  const response = await app().request("/index/retry-failed", { method: "POST" });
  expect(response.status).toBe(503);
});
it("reports queue or provider configuration failures without claiming completion", async () => {
  mocks.rebuild.mockRejectedValue(new Error("queue unavailable"));
  const response = await app().request("/index/rebuild", { method: "POST" });
  expect(response.status).toBe(503);
});
