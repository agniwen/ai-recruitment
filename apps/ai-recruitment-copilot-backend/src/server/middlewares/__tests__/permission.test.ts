import { describe, expect, it, vi } from "vitest";
import { usesRecruitingGroupPermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

describe("permission middleware", () => {
  it("does not delegate department or hiring unit writes to recruiting-group roles", () => {
    expect(usesRecruitingGroupPermission("department")).toBe(false);
    expect(usesRecruitingGroupPermission("hiringUnit")).toBe(false);
  });

  it("keeps recruiting-group delegation for scoped recruiting resources", () => {
    expect(usesRecruitingGroupPermission("interviewer")).toBe(true);
    expect(usesRecruitingGroupPermission("jd")).toBe(true);
    expect(usesRecruitingGroupPermission("resumeLibrary")).toBe(true);
    expect(usesRecruitingGroupPermission("resumeUploadBatch")).toBe(true);
  });
  it("requires workspace role grants for the resume pool", () => {
    expect(usesRecruitingGroupPermission("resumePool")).toBe(false);
  });
});
