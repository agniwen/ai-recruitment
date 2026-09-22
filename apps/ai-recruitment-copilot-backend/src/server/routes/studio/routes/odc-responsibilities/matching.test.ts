import { describe, expect, it, vi } from "vitest";
import { matchDepartments } from "./matching";
import { previewResponsibilityRows } from "./dao";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

const departments = [
  { id: "a", name: "Project X" },
  { id: "b", name: "1Mod" },
  { id: "c", name: "和合部门" },
];

describe("ODC department matching", () => {
  it("normalizes case and width and deduplicates departments", () => {
    expect(matchDepartments("project x、１mod和1Mod", departments)).toEqual({
      allDepartments: false,
      departmentIds: ["a", "b"],
    });
  });
  it("prefers exact names containing 和", () => {
    expect(matchDepartments("和合部门", departments).departmentIds).toEqual(["c"]);
  });
  it("rejects unknown and ambiguous departments", () => {
    expect(matchDepartments("不存在", departments).error).toBeTruthy();
    expect(matchDepartments("1mod", [...departments, { id: "d", name: "1Mod" }]).error).toContain(
      "重名",
    );
  });
  it("requires explicit whole-center scope", () => {
    expect(matchDepartments("全部部门", departments).allDepartments).toBe(true);
    expect(matchDepartments("不分小组的，张三和李四一起负责", departments).error).toBeTruthy();
  });
});

describe("ODC import preview", () => {
  const catalog = {
    assignments: [],
    centers: [{ id: "s", name: "中心" }],
    departments: departments.map((d) => ({ ...d, hiringUnitName: "单位", resumeSourceId: "s" })),
    members: [{ email: "a@example.com", id: "m", isOdc: true, name: "同名", telegram: null }],
    responsibilities: [],
  };
  const row = { center: "中心", departments: "1Mod", email: "a@example.com", name: "同名" };
  it("uses email, not name, and previews adding a center", () => {
    expect(previewResponsibilityRows([row], catalog)[0]).toMatchObject({
      addsCenter: true,
      departmentIds: ["b"],
      status: "ready",
    });
    expect(
      previewResponsibilityRows([{ ...row, email: "other@example.com" }], catalog)[0].status,
    ).toBe("invalid");
  });
  it("rejects non-ODC accounts and departments of a different center", () => {
    expect(
      previewResponsibilityRows([row], {
        ...catalog,
        members: [{ ...catalog.members[0], isOdc: false }],
      })[0].status,
    ).toBe("invalid");
    expect(
      previewResponsibilityRows([row], {
        ...catalog,
        departments: catalog.departments.map((d) => ({ ...d, resumeSourceId: "other" })),
      })[0].status,
    ).toBe("invalid");
  });
  it("recognizes a previously imported responsibility", () => {
    expect(
      previewResponsibilityRows([row], {
        ...catalog,
        responsibilities: [
          {
            createdAt: "2026-09-21",
            departmentId: "b",
            id: "r",
            memberId: "m",
            organizationId: "org",
            resumeSourceId: "s",
          },
        ],
      })[0].status,
    ).toBe("existing");
  });
});
