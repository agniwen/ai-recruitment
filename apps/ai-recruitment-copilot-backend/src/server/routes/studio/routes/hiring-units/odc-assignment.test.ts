import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAssignOdcMembers } from "./odc-assignment-policy";
import {
  odcAssignmentSchema,
  odcAssignmentUpdateSchema,
  odcBatchAssignmentSchema,
} from "@arc/shared/hiring-units";
import { parseOdcAssignmentPagination } from "./routes/odc/schema";

describe("canAssignOdcMembers", () => {
  it("accepts every selected member when all workspace roles are marked as ODC", () => {
    expect(
      canAssignOdcMembers({ memberIds: ["member-1", "member-2"], organizationId: "org-1" }, [
        { isOdc: true, memberId: "member-1", organizationId: "org-1" },
        { isOdc: true, memberId: "member-2", organizationId: "org-1" },
      ]),
    ).toBe(true);
  });

  it("rejects the full selection when any member is missing, belongs elsewhere, or is not ODC", () => {
    expect(
      canAssignOdcMembers({ memberIds: ["member-1", "member-2"], organizationId: "org-1" }, [
        { isOdc: true, memberId: "member-1", organizationId: "org-1" },
      ]),
    ).toBe(false);
    expect(
      canAssignOdcMembers({ memberIds: ["member-1"], organizationId: "org-1" }, [
        { isOdc: true, memberId: "member-1", organizationId: "org-2" },
      ]),
    ).toBe(false);
    expect(
      canAssignOdcMembers({ memberIds: ["member-1"], organizationId: "org-1" }, [
        { isOdc: false, memberId: "member-1", organizationId: "org-1" },
      ]),
    ).toBe(false);
  });
});

describe("department ODC route", () => {
  it("resolves the department through the actor scope before updating it", () => {
    const source = readFileSync(
      new URL("../departments/routes/odc/route.ts", import.meta.url),
      "utf-8",
    );
    const route = source.slice(source.indexOf(".put("), source.indexOf(".get("));

    expect(route).toContain("loadDepartmentById(id, activeOrg.id");
    expect(route).toContain("actorUserId: c.var.user?.id");
    expect(route.indexOf("loadDepartmentById")).toBeLessThan(
      route.indexOf("replaceDepartmentOdcMembers"),
    );
  });

  it("exposes paginated list, scope update, and delete operations", () => {
    const hiringUnitRoute = readFileSync(new URL("route.ts", import.meta.url), "utf-8");
    const departmentRoute = readFileSync(
      new URL("../departments/route.ts", import.meta.url),
      "utf-8",
    );
    const hiringUnitOdcRoute = readFileSync(
      new URL("routes/odc/route.ts", import.meta.url),
      "utf-8",
    );
    const departmentOdcRoute = readFileSync(
      new URL("../departments/routes/odc/route.ts", import.meta.url),
      "utf-8",
    );

    expect(hiringUnitRoute).toContain('.route("/:id/odc", hiringUnitOdcRouter)');
    expect(departmentRoute).toContain('.route("/:id/odc", departmentOdcRouter)');
    for (const source of [hiringUnitOdcRoute, departmentOdcRoute]) {
      expect(source).toMatch(/\.put\(\s*"\/"/u);
      expect(source).toMatch(/\.get\(\s*"\/"/u);
      expect(source).toMatch(/\.patch\(\s*"\/:memberId"/u);
      expect(source).toMatch(/\.delete\(\s*"\/:memberId"/u);
      expect(source).toContain("odcAssignmentPaginationSchema");
    }
  });
});

describe("ODC candidate route", () => {
  it("requires update permission for hiring units or departments", () => {
    const source = readFileSync(
      new URL("../workspace/routes/members/route.ts", import.meta.url),
      "utf-8",
    );

    expect(source).toContain('authorize({ action: "update", resource: "hiringUnit" })');
    expect(source).toContain('authorize({ action: "update", resource: "department" })');
    expect(source).toContain("canUpdateHiringUnits || canUpdateDepartments");
  });
});

describe("batch ODC assignment", () => {
  it("parses ODC management pagination with stable defaults", () => {
    expect(parseOdcAssignmentPagination({})).toEqual({
      page: 1,
      pageSize: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(parseOdcAssignmentPagination({ page: "2", pageSize: "20" })).toMatchObject({
      page: 2,
      pageSize: 20,
    });
    expect(() => parseOdcAssignmentPagination({ page: "invalid" })).toThrow();
    expect(() => parseOdcAssignmentPagination({ pageSize: "101" })).toThrow();
  });

  it("validates an editable ODC scope without changing the member", () => {
    expect(
      odcAssignmentUpdateSchema.safeParse({ jobSeries: "派驻", serviceUnit: "无极" }).success,
    ).toBe(true);
    expect(
      odcAssignmentUpdateSchema.safeParse({ jobSeries: "其他", serviceUnit: null }).success,
    ).toBe(false);
  });

  it("accepts optional per-member job series and service-unit scopes", () => {
    expect(
      odcAssignmentSchema.safeParse({
        assignments: [
          { jobSeries: "直属", memberId: "member-1", serviceUnit: "悦达" },
          { jobSeries: null, memberId: "member-2", serviceUnit: null },
        ],
      }).success,
    ).toBe(true);
    expect(
      odcAssignmentSchema.safeParse({
        assignments: [{ jobSeries: "其他", memberId: "member-1", serviceUnit: null }],
      }).success,
    ).toBe(false);
    expect(
      odcAssignmentSchema.safeParse({
        assignments: [
          { jobSeries: null, memberId: "member-1", serviceUnit: null },
          { jobSeries: "派驻", memberId: "member-1", serviceUnit: "无极" },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts mixed unique targets and rejects duplicate targets", () => {
    expect(
      odcBatchAssignmentSchema.safeParse({
        assignments: [{ jobSeries: "派驻", memberId: "member-1", serviceUnit: "无极" }],
        targets: [
          { id: "unit-1", rowType: "hiringUnit" },
          { id: "department-1", rowType: "department" },
        ],
      }).success,
    ).toBe(true);
    expect(
      odcBatchAssignmentSchema.safeParse({
        assignments: [],
        targets: [
          { id: "unit-1", rowType: "hiringUnit" },
          { id: "unit-1", rowType: "hiringUnit" },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses one atomic overwrite path after mixed permission checks", () => {
    const routeSource = readFileSync(new URL("route.ts", import.meta.url), "utf-8");
    const daoSource = readFileSync(new URL("dao.ts", import.meta.url), "utf-8");

    expect(routeSource).toContain('"/odc/batch"');
    expect(routeSource).toContain('resource: "hiringUnit"');
    expect(routeSource).toContain('resource: "department"');
    expect(routeSource).toContain("replaceOdcMembersForTargets");
    expect(daoSource).toContain("export function replaceOdcMembersForTargets");
    expect(daoSource).toContain("return db.transaction");
    expect(daoSource).toContain("delete(hiringUnitOdcMember)");
    expect(daoSource).toContain("delete(departmentOdcMember)");
  });
});
