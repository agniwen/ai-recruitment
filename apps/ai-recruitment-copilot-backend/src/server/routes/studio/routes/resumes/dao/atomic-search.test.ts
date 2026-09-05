import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { studioInterview, resumePoolItem } from "@arc/db-schema/schema";
import { buildResumeAtomicSearch } from "./atomic-search";

const dialect = new PgDialect();
describe("atomic resume filters", () => {
  it("escapes SQL wildcards and combines fields with AND for both resources", () => {
    for (const columns of [studioInterview, resumePoolItem]) {
      const where = buildResumeAtomicSearch(
        columns,
        JSON.stringify({ candidateName: "A_%!", company: "测试公司" }),
      );
      if (!where) {
        throw new Error("Missing filter predicate");
      }
      const query = dialect.sqlToQuery(where);
      expect(query.params).toEqual(["%A!_!%!!%", "%测试公司%"]);
      expect(query.sql).toContain(" and ");
      expect(query.sql).toContain("workExperiences");
      expect(query.sql).not.toContain("educationExperiences");
    }
  });
  it("rejects unsupported fields and non-scalar values", () => {
    expect(() => buildResumeAtomicSearch(studioInterview, '{"organizationId":"other"}')).toThrow();
    expect(() => buildResumeAtomicSearch(studioInterview, '{"company":["a"]}')).toThrow();
  });
  it("does not add a predicate when no values were submitted", () => {
    expect(buildResumeAtomicSearch(studioInterview)).toBeUndefined();
    expect(buildResumeAtomicSearch(resumePoolItem, "{}")).toBeUndefined();
  });
});
