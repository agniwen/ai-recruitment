import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { resumeProtectionRouter } from "./route";

const mocks = vi.hoisted(() => ({ details: vi.fn(), visible: vi.fn() }));
vi.mock("./continue-route", async () => {
  const { factory: testFactory } =
    await import("@arc/ai-recruitment-copilot-backend/server/factory");
  return { resumeProtectionContinueRouter: testFactory.createApp() };
});
vi.mock("../../dao/protection", () => ({ loadResumeProtectionDetails: mocks.details }));
vi.mock("../../dao/resumes", () => ({ loadResumeDetail: mocks.visible }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  resolveResumeVisibilityScope: () => Promise.resolve({ recruiting: { kind: "all" } }),
}));

const app = factory
  .createApp()
  .use("*", async (c, next) => {
    c.set("activeOrg", { id: "workspace" } as NonNullable<typeof c.var.activeOrg>);
    c.set("user", { id: "user" } as NonNullable<typeof c.var.user>);
    await next();
  })
  .route("/:id/protection", resumeProtectionRouter);
beforeEach(() => {
  vi.clearAllMocks();
});
describe("protection details access", () => {
  it("does not disclose cross-team history without access to the uploaded source", async () => {
    mocks.visible.mockResolvedValue(null);
    const result = await app.request("/blocked/protection");
    expect(result.status).toBe(404);
    expect(mocks.details).not.toHaveBeenCalled();
  });
  it("uses the authenticated workspace and source id for the minimal history", async () => {
    mocks.visible.mockResolvedValue({ id: "blocked" });
    mocks.details.mockResolvedValue({ protection: { ownerName: "王晓" }, recommendations: [] });
    const result = await app.request("/blocked/protection");
    expect(result.status).toBe(200);
    expect(mocks.details).toHaveBeenCalledWith("blocked", "workspace");
    expect(await result.json()).toEqual({ protection: { ownerName: "王晓" }, recommendations: [] });
  });
});
