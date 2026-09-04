import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("department ODC management", () => {
  it("shows ODC avatars and opens the shared assignment dialog", () => {
    const pageSource = readFileSync(
      new URL("department-management-page.tsx", import.meta.url),
      "utf-8",
    );
    const daoSource = readFileSync(
      new URL(
        "../../../../../../ai-recruitment-copilot-backend/src/server/routes/studio/routes/departments/dao.ts",
        import.meta.url,
      ),
      "utf-8",
    );
    const sharedSource = readFileSync(
      new URL("../../../../../../../packages/shared/src/departments.ts", import.meta.url),
      "utf-8",
    );

    expect(pageSource).toContain("<OdcAvatarGroup");
    expect(pageSource).toContain('label: "设置 ODC"');
    expect(pageSource).toContain("<OdcAssignmentDialog");
    expect(daoSource).toContain("loadDepartmentOdcMembersByIds");
    expect(daoSource).toContain("odcMembers:");
    expect(sharedSource).toContain("odcMembers: OdcMemberSummary[]");
  });
});
