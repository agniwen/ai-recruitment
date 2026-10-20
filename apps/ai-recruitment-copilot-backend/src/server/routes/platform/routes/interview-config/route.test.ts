import { beforeEach, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { adminMiddleware } from "@arc/ai-recruitment-copilot-backend/server/middlewares/admin";
import { platformMfaMiddleware } from "@arc/ai-recruitment-copilot-backend/server/middlewares/platform-mfa";
import { platformInterviewConfigRouter } from "./route";

const mocks = vi.hoisted(() => ({ load: vi.fn(), mfa: vi.fn(), save: vi.fn() }));
vi.mock("./dao", () => ({
  loadPlatformInterviewConfig: mocks.load,
  savePlatformInterviewConfig: mocks.save,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/security/mfa/service", () => ({
  SecurityError: class extends Error {},
  requireRecentMfa: mocks.mfa,
}));

function app(role?: string, mfaSession = true) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      if (role) {
        c.set("user", { id: "admin", role } as never);
      }
      if (mfaSession) {
        c.set("session", { id: "session" } as never);
      }
      await next();
    })
    .use(adminMiddleware)
    .use(platformMfaMiddleware)
    .route("/platform/interview-config", platformInterviewConfigRouter);
}
const request = (hours: unknown) => ({
  body: JSON.stringify({ humanInterviewLockHours: hours }),
  headers: { "Content-Type": "application/json", origin: "https://example.test" },
  method: "PUT",
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
  mocks.load.mockResolvedValue({ humanInterviewLockHours: 48 });
  mocks.save.mockImplementation((input) => Promise.resolve(input));
  mocks.mfa.mockResolvedValue(null);
});

it("requires platform admin access and a verified platform session", async () => {
  const anonymous = await app().request("/platform/interview-config");
  const member = await app("user").request("/platform/interview-config");
  const unverified = await app("admin", false).request("/platform/interview-config");
  expect(anonymous.status).toBe(401);
  expect(member.status).toBe(403);
  expect(unverified.status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("reads and saves the configurable hours", async () => {
  const response = await app("admin").request("/platform/interview-config");
  expect(await response.json()).toEqual({ humanInterviewLockHours: 48 });
  const saved = await app("admin").request("/platform/interview-config", request(24));
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ humanInterviewLockHours: 24 });
  expect(mocks.save).toHaveBeenCalledWith({ humanInterviewLockHours: 24 });
});
it.each([0, -1, 1.5, 8761, "24", null])("rejects invalid duration %s", async (hours) => {
  const response = await app("admin").request("/platform/interview-config", request(hours));
  expect(response.status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
