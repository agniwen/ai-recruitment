import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { studioInterview } from "@arc/db-schema/schema";
import { ODC_ANALYSIS_UNKNOWN_ROLE } from "@arc/shared/odc-analysis";
import { matchesSelectedRole, roleCondition } from "./role-filter";

describe("ODC analysis role filtering", () => {
  it("binds a selected role and maps the unknown sentinel to NULL", () => {
    const dialect = new PgDialect();
    const selected = dialect.sqlToQuery(
      roleCondition(studioInterview.createdByRole, "odc") ?? sql`false`,
    );
    const unknown = dialect.sqlToQuery(
      roleCondition(studioInterview.createdByRole, ODC_ANALYSIS_UNKNOWN_ROLE) ?? sql`false`,
    );

    expect(selected.params).toEqual(["odc"]);
    expect(unknown.params).toEqual([]);
    expect(unknown.sql).toContain("is null");
  });

  it("matches known, unknown, and unfiltered role values", () => {
    expect(matchesSelectedRole("odc", "odc")).toBe(true);
    expect(matchesSelectedRole("hr", "odc")).toBe(false);
    expect(matchesSelectedRole(null, ODC_ANALYSIS_UNKNOWN_ROLE)).toBe(true);
    expect(matchesSelectedRole("odc", ODC_ANALYSIS_UNKNOWN_ROLE)).toBe(false);
    expect(matchesSelectedRole("hr")).toBe(true);
  });
});
