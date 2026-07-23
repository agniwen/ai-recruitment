import { describe, expect, it } from "vitest";

import { selectColumn } from "../select-column";

describe("selectColumn", () => {
  it("locks the selection column to its rendered width", () => {
    const column = selectColumn<{ id: string }>();

    expect(column.size).toBe(40);
    expect(column.minSize).toBe(40);
    expect(column.maxSize).toBe(40);
  });
});
