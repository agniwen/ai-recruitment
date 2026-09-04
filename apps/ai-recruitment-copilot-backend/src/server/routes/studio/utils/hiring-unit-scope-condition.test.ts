import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  buildDepartmentHiringUnitScopeCondition,
  buildJobDescriptionHiringUnitScopeCondition,
} from "./hiring-unit-scope";

describe("buildJobDescriptionHiringUnitScopeCondition", () => {
  it("matches selected units directly and through every child department", () => {
    const condition = buildJobDescriptionHiringUnitScopeCondition({
      canAccessAll: false,
      canAccessPublic: false,
      departmentIds: [],
      hiringUnitIds: ["hiring-unit-1", "hiring-unit-2"],
    });
    if (!condition) {
      throw new Error("Expected a hiring-unit SQL condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"job_description"."hiring_unit_id" in');
    expect(query.sql).toContain('"department"."hiring_unit_id" in');
    expect(query.params).toEqual([
      "hiring-unit-1",
      "hiring-unit-2",
      "hiring-unit-1",
      "hiring-unit-2",
    ]);
  });

  it("keeps public null-unit access source-aware", () => {
    const condition = buildJobDescriptionHiringUnitScopeCondition({
      canAccessAll: false,
      canAccessPublic: true,
      departmentIds: [],
      hiringUnitIds: ["hiring-unit-1"],
    });
    if (!condition) {
      throw new Error("Expected a scoped SQL condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"job_description"."creation_source"');
    expect(query.sql.match(/"job_description"."hiring_unit_id" is null/g)).toHaveLength(1);
    expect(query.params).toContain("manual");
    expect(query.params).toContain("google_sheets");
  });

  it("matches jobs assigned directly to an ODC department without granting sibling departments", () => {
    const condition = buildJobDescriptionHiringUnitScopeCondition({
      canAccessAll: false,
      canAccessPublic: false,
      departmentIds: ["department-1"],
      hiringUnitIds: [],
    });
    if (!condition) {
      throw new Error("Expected a department SQL condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"job_description"."department_id" in');
    expect(query.sql).not.toContain('"department"."hiring_unit_id" in');
    expect(query.params).toEqual(["department-1"]);
  });
});

describe("buildDepartmentHiringUnitScopeCondition", () => {
  it("unions hiring-unit descendants with directly assigned ODC departments", () => {
    const condition = buildDepartmentHiringUnitScopeCondition({
      canAccessAll: false,
      canAccessPublic: false,
      departmentIds: ["department-1"],
      hiringUnitIds: ["hiring-unit-1"],
    });
    if (!condition) {
      throw new Error("Expected a department SQL condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"department"."id" in');
    expect(query.sql).toContain('"department"."hiring_unit_id" in');
    expect(query.params).toEqual(["department-1", "hiring-unit-1"]);
  });
});
