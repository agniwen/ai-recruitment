import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { HumanInterviewMeetingError } from "../../../../dao/human-interview-meeting-access";
import { humanInterviewConflictsRouter } from "./route";

const mocks = vi.hoisted(() => ({ allowed: true, checks: [] as string[], findConflicts: vi.fn() }));
vi.mock("../../../../dao/human-interview-conflicts", () => ({
  findHumanInterviewConflicts: mocks.findConflicts,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: (resource: string, action: string) =>
    factory.createMiddleware(async (c, next) => {
      mocks.checks.push(`${resource}:${action}`);
      if (!mocks.allowed) {
        return c.json({ error: "Forbidden" }, 403);
      }
      await next();
    }),
}));
function makeApp(organizationId: string | null = "org") {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", organizationId ? ({ id: organizationId } as never) : null);
      await next();
    })
    .route("/human-interview-meetings/conflicts", humanInterviewConflictsRouter);
}
function request(input: unknown) {
  return {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };
}
const input = {
  interviewerIds: ["001"],
  scheduledAt: "2026-09-18T01:00:00Z",
  validUntil: "2026-09-18T02:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.checks.length = 0;
  mocks.findConflicts.mockResolvedValue([]);
});
describe("human interview conflict preflight", () => {
  it("uses the active workspace and create permission without requiring calendar visibility", async () => {
    const response = await makeApp().request(
      "/human-interview-meetings/conflicts",
      request({ ...input, organizationId: "other" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conflicts: [] });
    expect(mocks.findConflicts).toHaveBeenCalledWith({ input, organizationId: "org" });
    expect(mocks.checks).toEqual(["humanInterview:create"]);
  });
  it("rejects callers without create permission or a workspace", async () => {
    mocks.allowed = false;
    const forbidden = await makeApp().request(
      "/human-interview-meetings/conflicts",
      request(input),
    );
    expect(forbidden.status).toBe(403);
    mocks.allowed = true;
    const unauthorized = await makeApp(null).request(
      "/human-interview-meetings/conflicts",
      request(input),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.findConflicts).not.toHaveBeenCalled();
  });
  it("rejects malformed times and empty interviewer selections", async () => {
    for (const invalid of [
      { ...input, scheduledAt: "invalid" },
      { ...input, interviewerIds: [] },
    ]) {
      const response = await makeApp().request(
        "/human-interview-meetings/conflicts",
        request(invalid),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.findConflicts).not.toHaveBeenCalled();
  });
  it("returns validation errors instead of treating failed checks as no conflict", async () => {
    mocks.findConflicts.mockRejectedValue(
      new HumanInterviewMeetingError("有效时间至必须晚于面试时间。", 400),
    );
    const response = await makeApp().request("/human-interview-meetings/conflicts", request(input));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "有效时间至必须晚于面试时间。" });
  });
});
