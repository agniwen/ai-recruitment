import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { studioInterview } from "@arc/db-schema/schema";

describe("resume pool source provenance schema", () => {
  it("keeps the source pool id as a durable snapshot instead of a deleting foreign key", () => {
    const config = getTableConfig(studioInterview);
    const sourceColumnForeignKeys = config.foreignKeys.filter((foreignKey) =>
      foreignKey.reference().columns.some((column) => column.name === "resume_source_pool_item_id"),
    );

    expect(sourceColumnForeignKeys).toEqual([]);
    expect(studioInterview.resumeSourcePoolItemId.notNull).toBe(false);
  });
});
