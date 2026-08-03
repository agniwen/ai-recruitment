import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dataGridSource = readFileSync(new URL("../data-grid.tsx", import.meta.url), "utf-8");
const tableSource = readFileSync(new URL("../../ui/table.tsx", import.meta.url), "utf-8");

describe("DataGrid header cells", () => {
  it("renders vertical dividers between header cells", () => {
    expect(dataGridSource).toContain("<TableRow key={headerGroup.id}>");
    expect(tableSource).toContain("not-in-data-[variant=card]:border-r");
    expect(tableSource).toContain("not-in-data-[variant=card]:last:border-r-0");
    expect(dataGridSource).not.toContain("after:absolute after:inset-y-1.5");
  });
});
