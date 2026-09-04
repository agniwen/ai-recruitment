import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(join(import.meta.dirname, "..", "route.ts"), "utf-8");
const daoSource = readFileSync(join(import.meta.dirname, "..", "dao.ts"), "utf-8");

describe("hiring units route permissions", () => {
  it("allows any authenticated workspace member to read selectable hiring units", () => {
    const selectableStart = routeSource.indexOf('.get("/selectable"');
    const createStart = routeSource.indexOf(".post(");
    const selectableRoute = routeSource.slice(selectableStart, createStart);

    expect(selectableStart).toBeGreaterThanOrEqual(0);
    expect(selectableRoute).not.toContain("requirePermission");
    expect(selectableRoute).toContain("listSelectableHiringUnits");
  });

  it("keeps management endpoints protected by hiring unit resource permissions", () => {
    expect(routeSource).toContain('.get(\n    "/",\n    requirePermission("hiringUnit", "read")');
    expect(routeSource).toContain('.get("/all", requirePermission("hiringUnit", "read")');
    expect(routeSource).toContain('requirePermission("hiringUnit", "create")');
    expect(routeSource).toContain('requirePermission("hiringUnit", "update")');
    expect(routeSource).toContain('requirePermission("hiringUnit", "delete")');
    expect(routeSource).toContain('requirePermission("department", "read")');
    expect(routeSource).toContain('"/:id/odc",\n    requirePermission("hiringUnit", "update")');
  });

  it("applies the actor hiring-unit scope to departments in the tree", () => {
    expect(routeSource).toContain("actorUserId: c.var.user?.id");
    expect(daoSource).toContain("resolveDepartmentHiringUnitScopeCondition");
    expect(daoSource).toContain(
      ".where(and(eq(department.organizationId, organizationId), departmentScopeCondition))",
    );
  });
});
