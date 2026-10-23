import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requireResumeAnalysisAdmission } from "./protection-guard";

const mocks = vi.hoisted(() => ({ conflict: vi.fn(), generate: vi.fn(), record: vi.fn() }));
vi.mock("../../../studio/routes/resumes/dao/protection", () => ({
  findResumeProtectionConflict: mocks.conflict,
}));
vi.mock("../../../studio/routes/resumes/dao/resumes", () => ({ loadResumeDetail: mocks.record }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  resolveResumeVisibilityScope: () => Promise.resolve({ recruiting: { kind: "all" } }),
}));
const profile = {
  age: null,
  educationExperiences: [],
  email: "c@example.com",
  gender: null,
  name: "陈安",
  personalStrengths: [],
  phone: "13800000000",
  projectExperiences: [],
  schools: [],
  skills: [],
  targetRoles: [],
  workExperiences: [],
  workYears: 3,
};
const app = factory
  .createApp()
  .use("*", async (c, next) => {
    c.set("activeOrg", { id: "workspace" } as NonNullable<typeof c.var.activeOrg>);
    c.set("user", { id: "reviewer" } as NonNullable<typeof c.var.user>);
    await next();
  })
  .post("/analyze", requireResumeAnalysisAdmission, (c) => {
    mocks.generate();
    return c.json({ ok: true }, 200);
  });
function request(interviewRecordId?: string, resumeProfile = profile) {
  return app.request("/analyze", {
    body: JSON.stringify({ interviewRecordId, resumeProfile }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.conflict.mockResolvedValue({ ownerUserId: "original-recommender" });
});
describe("analysis admission", () => {
  it("stops an upload before JD matching, question generation or evaluation", async () => {
    const result = await request();
    expect(result.status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("allows a reviewer to work on an authorized accepted original recommendation", async () => {
    mocks.record.mockResolvedValue({ resumeAdmissionStatus: "accepted", resumeProfile: profile });
    const result = await request("original");
    expect(result.status).toBe(200);
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.conflict).not.toHaveBeenCalled();
  });
  it("cannot use a protected or invisible record as an analysis bypass", async () => {
    mocks.record.mockResolvedValue({ resumeAdmissionStatus: "protected", resumeProfile: profile });
    const result = await request("blocked");
    expect(result.status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("cannot attach a different candidate to an accepted record id", async () => {
    mocks.record.mockResolvedValue({
      resumeAdmissionStatus: "accepted",
      resumeProfile: { ...profile, name: "其他人" },
    });
    const result = await request("original");
    expect(result.status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
