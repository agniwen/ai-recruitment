import { describe, expect, it } from "vitest";
import { usesRecruitingGroupPermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";

describe("permission middleware", () => {
  it("does not delegate department or hiring unit writes to recruiting-group roles", () => {
    expect(usesRecruitingGroupPermission("department")).toBe(false);
    expect(usesRecruitingGroupPermission("hiringUnit")).toBe(false);
  });

  it("keeps recruiting-group delegation for scoped recruiting resources", () => {
    expect(usesRecruitingGroupPermission("interviewer")).toBe(true);
    expect(usesRecruitingGroupPermission("jd")).toBe(true);
    expect(usesRecruitingGroupPermission("resume")).toBe(true);
  });
});
