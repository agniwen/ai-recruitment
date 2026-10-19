import { beforeEach, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { humanInterviewLockRouter } from "./route";

const mocks = vi.hoisted(() => ({ allowed: true, find: vi.fn() }));
vi.mock("../../dao/human-interview-candidate-lock", () => ({
  findHumanInterviewCandidateLock: mocks.find,
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
function app(organizationId: string | null = "workspace") {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", organizationId ? ({ id: organizationId } as never) : null);
      await next();
    })
    .route("/:id/human-interview-lock", humanInterviewLockRouter);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.find.mockResolvedValue(null);
});
it("checks the requested candidate in the active workspace and prevents caching", async () => {
  const response = await app().request("/candidate/human-interview-lock?organizationId=other");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ lock: null });
  expect(mocks.find).toHaveBeenCalledWith({
    interviewRecordId: "candidate",
    organizationId: "workspace",
  });
});
it("returns the unit name, remaining time message and release time", async () => {
  const lock = {
    hiringUnitName: "A用工单位",
    message: "该候选人已被A用工单位约面",
    unlockAt: "2026-10-21T10:00:00Z",
  };
  mocks.find.mockResolvedValue(lock);
  const response = await app().request("/candidate/human-interview-lock");
  expect(await response.json()).toEqual({ lock });
});
it("requires workspace membership and create permission", async () => {
  const unauthorized = await app(null).request("/candidate/human-interview-lock");
  expect(unauthorized.status).toBe(401);
  mocks.allowed = false;
  const forbidden = await app().request("/candidate/human-interview-lock");
  expect(forbidden.status).toBe(403);
  expect(mocks.find).not.toHaveBeenCalled();
});
