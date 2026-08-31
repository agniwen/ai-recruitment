import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { studioInterview } from "@arc/db-schema/schema";
import { matchesOdcRole, odcRoleCondition } from "./role-filter";

describe("ODC analysis role filtering", () => {
  it("binds every configured ODC role", () => {
    const dialect = new PgDialect();
    const selected = dialect.sqlToQuery(
      odcRoleCondition(studioInterview.createdByRole, ["odc", "odc-lead"]),
    );

    expect(selected.params).toEqual(["odc", "odc-lead"]);
    expect(selected.sql).toContain("regexp_split_to_array");
    expect(selected.sql).toContain("&& ARRAY[");
  });

  it("matches only configured ODC roles and rejects unknown history", () => {
    const odcRoles = ["odc", "odc-lead"];

    expect(matchesOdcRole("odc", odcRoles)).toBe(true);
    expect(matchesOdcRole("odc-lead", odcRoles)).toBe(true);
    expect(matchesOdcRole("member, odc", odcRoles)).toBe(true);
    expect(matchesOdcRole("odc-lead,member", odcRoles)).toBe(true);
    expect(matchesOdcRole("hr", odcRoles)).toBe(false);
    expect(matchesOdcRole("odc-assistant,member", odcRoles)).toBe(false);
    expect(matchesOdcRole(null, odcRoles)).toBe(false);
    expect(matchesOdcRole("odc", [])).toBe(false);
  });

  it("emits a false condition when no role is marked as ODC", () => {
    const dialect = new PgDialect();
    const condition = dialect.sqlToQuery(odcRoleCondition(studioInterview.createdByRole, []));

    expect(condition.params).toEqual([]);
    expect(condition.sql).toBe("false");
  });
});
