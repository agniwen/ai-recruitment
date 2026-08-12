import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { historicalResumeImportOrderBy } from "../dao";

describe("historicalResumeImportOrderBy", () => {
  it("does not emit a positional zero for failed records", () => {
    const dialect = new PgDialect();
    const orderBy = historicalResumeImportOrderBy("failed").map(
      (expression) => dialect.sqlToQuery(expression).sql,
    );

    expect(orderBy).toHaveLength(2);
    expect(orderBy).not.toContain("0");
  });

  it("keeps processing records before successful records", () => {
    const dialect = new PgDialect();
    const [statusOrder] = historicalResumeImportOrderBy("records");

    expect(dialect.sqlToQuery(statusOrder).sql).toContain("case when");
  });
});
