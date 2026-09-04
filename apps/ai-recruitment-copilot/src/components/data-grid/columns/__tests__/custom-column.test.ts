import { describe, expect, it } from "vitest";

import { customColumn } from "../custom-column";

describe("customColumn", () => {
  it("forwards fixed width constraints", () => {
    const column = customColumn<{ id: string }>({
      cell: (row) => row.id,
      key: "id",
      maxSize: 160,
      minSize: 160,
      size: 160,
      title: "ODC",
    });

    expect(column.size).toBe(160);
    expect(column.minSize).toBe(160);
    expect(column.maxSize).toBe(160);
  });
});
