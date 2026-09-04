import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAssignOdcMembers } from "./odc-assignment-policy";
import { odcBatchAssignmentSchema } from "@arc/shared/hiring-units";

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
    const source = readFileSync(new URL("../departments/route.ts", import.meta.url), "utf-8");
    const route = source.slice(source.indexOf('"/:id/odc"'), source.indexOf('.delete("/:id"'));

    expect(route).toContain("loadDepartmentById(id, activeOrg.id");
    expect(route).toContain("actorUserId: c.var.user?.id");
    expect(route.indexOf("loadDepartmentById")).toBeLessThan(
      route.indexOf("replaceDepartmentOdcMembers"),
    );
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
  it("accepts mixed unique targets and rejects duplicate targets", () => {
    expect(
      odcBatchAssignmentSchema.safeParse({
        memberIds: ["member-1"],
        targets: [
          { id: "unit-1", rowType: "hiringUnit" },
          { id: "department-1", rowType: "department" },
        ],
      }).success,
    ).toBe(true);
    expect(
      odcBatchAssignmentSchema.safeParse({
        memberIds: [],
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
