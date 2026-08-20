import { and, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { studioInterview } from "@arc/db-schema/schema";
import { instantRangeConditions } from "./instant-range-conditions";

describe("ODC analysis instant range SQL", () => {
  it("encodes Date bounds through the timestamp column encoder", () => {
    const start = new Date("2026-08-19T16:00:00.000Z");
    const end = new Date("2026-08-20T16:00:00.000Z");
    const condition = and(...instantRangeConditions(studioInterview.createdAt, { end, start }));

    const query = new PgDialect().sqlToQuery(condition ?? sql`false`);

    expect(query.params).toEqual([start.toISOString(), end.toISOString()]);
  });
});
