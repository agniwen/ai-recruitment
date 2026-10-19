import { describe, expect, it } from "vitest";
import { previewSscResponsibilityRows } from "./import-matching";

const row = {
  centerName: "COE",
  demandOwner: "负责人",
  email: "SSC@EXAMPLE.COM",
  notes: "",
  row: 2,
  sscName: "小林",
  telegram: "@ssc",
};
const catalog = {
  existing: [],
  resumeSources: [{ id: "source-a", name: "COE" }],
  roles: [{ label: "SSC审核角色", value: "ssc" }],
};

describe("SSC responsibility import matching", () => {
  it("matches a unique workspace source and normalizes email", () => {
    expect(previewSscResponsibilityRows([row], "ssc", catalog)).toMatchObject([
      {
        input: {
          centerName: "COE",
          email: "ssc@example.com",
          resumeSourceId: "source-a",
          workspaceRole: "ssc",
        },
        row: 2,
        status: "new",
      },
    ]);
  });

  it("keeps unmatched organizations and empty contacts as pending pre-entry", () => {
    expect(
      previewSscResponsibilityRows(
        [{ ...row, centerName: "未建中心", email: "", sscName: "", telegram: "" }],
        "ssc",
        catalog,
      ),
    ).toMatchObject([
      { input: { centerName: "未建中心", email: "", resumeSourceId: null }, status: "new" },
    ]);
  });

  it("does not guess ambiguous centers", () => {
    const result = previewSscResponsibilityRows([row], "ssc", {
      ...catalog,
      resumeSources: [...catalog.resumeSources, { id: "source-b", name: "coe" }],
    });
    expect(result[0]).toMatchObject({ status: "invalid" });
    expect(result[0].error).toContain("同名");
  });

  it("skips duplicate identities already saved and within the file", () => {
    const existing = { ...row, resumeSourceId: "source-a", workspaceRole: "ssc" };
    expect(
      previewSscResponsibilityRows([row], "ssc", { ...catalog, existing: [existing] })[0].status,
    ).toBe("existing");
    expect(
      previewSscResponsibilityRows([row, { ...row, row: 3 }], "ssc", catalog).map((r) => r.status),
    ).toEqual(["new", "existing"]);
  });

  it("rejects invalid emails, non-SSC roles, and conflicting roles without widening access", () => {
    expect(
      previewSscResponsibilityRows([{ ...row, email: "invalid" }], "ssc", catalog)[0].status,
    ).toBe("invalid");
    expect(previewSscResponsibilityRows([row], "admin", catalog)[0].status).toBe("invalid");
    const existing = {
      ...row,
      centerName: "Elsewhere",
      resumeSourceId: null,
      workspaceRole: "other-ssc",
    };
    expect(
      previewSscResponsibilityRows([row], "ssc", { ...catalog, existing: [existing] })[0],
    ).toMatchObject({ status: "invalid" });
  });
});
