import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { externalInterviewersRouter } from "./route";

const mocks = vi.hoisted(() => ({ allowed: true, bindings: vi.fn(), defaults: vi.fn() }));
vi.mock("../../../../dao/external-interviewers", () => ({
  loadExternalInterviewerDefaults: mocks.defaults,
  resolveExternalInterviewerBindings: mocks.bindings,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () =>
    factory.createMiddleware(async (c, next) => {
      if (!mocks.allowed) {
        return c.json({ error: "Forbidden" }, 403);
      }
      await next();
    }),
}));
function app(organizationId: string | null = "org") {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", organizationId ? ({ id: organizationId } as never) : null);
      await next();
    })
    .route("/external", externalInterviewersRouter);
}
function request(interviewers: unknown) {
  return {
    body: JSON.stringify({ interviewers, organizationId: "other" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.defaults.mockResolvedValue([{ name: "张三", telegram: "@tester1" }]);
  mocks.bindings.mockResolvedValue([
    { chatId: "private-chat", name: "张三", telegram: "@tester1" },
  ]);
});
describe("external interviewer preflight", () => {
  it("loads defaults within the active workspace", async () => {
    const response = await app().request("/external?candidateId=candidate");
    expect(response.status).toBe(200);
    expect(mocks.defaults).toHaveBeenCalledWith("candidate", "org");
  });
  it("returns binding status without exposing chat IDs", async () => {
    const response = await app().request(
      "/external/check",
      request([{ name: "张三", telegram: "@tester1" }]),
    );
    expect(response.status).toBe(200);
    expect(mocks.bindings).toHaveBeenCalledWith("org", [{ name: "张三", telegram: "@tester1" }]);
    expect(await response.json()).toEqual([{ bound: true, name: "张三", telegram: "@tester1" }]);
  });
  it("requires create permission and an active workspace", async () => {
    mocks.allowed = false;
    const forbiddenDefaults = await app().request("/external?candidateId=candidate");
    expect(forbiddenDefaults.status).toBe(403);
    const forbiddenCheck = await app().request("/external/check", request([]));
    expect(forbiddenCheck.status).toBe(403);
    mocks.allowed = true;
    const unauthorized = await app(null).request("/external?candidateId=candidate");
    expect(unauthorized.status).toBe(401);
    expect(mocks.defaults).not.toHaveBeenCalled();
    expect(mocks.bindings).not.toHaveBeenCalled();
  });
  it("rejects missing candidates and invalid names", async () => {
    mocks.defaults.mockResolvedValue(null);
    const missing = await app().request("/external?candidateId=missing");
    expect(missing.status).toBe(404);
    const invalid = await app().request("/external/check", request([{ name: "", telegram: "" }]));
    expect(invalid.status).toBe(400);
    expect(mocks.bindings).not.toHaveBeenCalled();
  });
});
