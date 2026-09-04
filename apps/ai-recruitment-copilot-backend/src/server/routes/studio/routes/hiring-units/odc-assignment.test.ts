import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAssignOdcMember } from "./odc-assignment-policy";

describe("canAssignOdcMember", () => {
  it("accepts a member whose workspace role is marked as ODC", () => {
    expect(
      canAssignOdcMember(
        { memberId: "member-1", organizationId: "org-1" },
        { isOdc: true, memberId: "member-1", organizationId: "org-1" },
      ),
    ).toBe(true);
  });

  it("rejects members from another workspace or a non-ODC role", () => {
    expect(
      canAssignOdcMember(
        { memberId: "member-1", organizationId: "org-1" },
        { isOdc: true, memberId: "member-1", organizationId: "org-2" },
      ),
    ).toBe(false);
    expect(
      canAssignOdcMember(
        { memberId: "member-1", organizationId: "org-1" },
        { isOdc: false, memberId: "member-1", organizationId: "org-1" },
      ),
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
      route.indexOf("updateDepartmentOdcMember"),
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
