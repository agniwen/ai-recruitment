import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { buildJobDescriptionHiringUnitScopeCondition } from "./hiring-unit-scope";

describe("buildJobDescriptionHiringUnitScopeCondition", () => {
  it("uses department fallback only for manual jobs", () => {
    const condition = buildJobDescriptionHiringUnitScopeCondition({
      canAccessAll: false,
      canAccessPublic: true,
      hiringUnitIds: ["hiring-unit-1"],
    });
    if (!condition) {
      throw new Error("Expected a scoped SQL condition");
    }

    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain('"job_description"."creation_source"');
    expect(query.sql.match(/"job_description"."hiring_unit_id" is null/g)).toHaveLength(2);
    expect(query.params).toContain("manual");
    expect(query.params).toContain("google_sheets");
  });
});
