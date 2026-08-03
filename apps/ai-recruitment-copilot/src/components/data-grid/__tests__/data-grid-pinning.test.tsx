// @vitest-environment jsdom

import type { ColumnDef } from "@tanstack/react-table";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGrid } from "@/components/data-grid/data-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  id: string;
  leftInner: string;
  leftOuter: string;
  rightInner: string;
  rightOuter: string;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: "leftOuter", header: "左外" },
  { accessorKey: "leftInner", header: "左内" },
  { accessorKey: "rightInner", header: "右内" },
  { accessorKey: "rightOuter", header: "右外" },
];

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("DataGrid pinned column dividers", () => {
  it("keeps opaque dividers between adjacent columns pinned to either side", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <DataGrid
          columnPinning={{
            left: ["leftOuter", "leftInner"],
            right: ["rightInner", "rightOuter"],
          }}
          columns={columns}
          data={[
            {
              id: "1",
              leftInner: "左内",
              leftOuter: "左外",
              rightInner: "右内",
              rightOuter: "右外",
            },
          ]}
          empty={null}
          getRowId={(row) => row.id}
          pagination={{
            onPageChange: vi.fn(),
            onPageSizeChange: vi.fn(),
            page: 1,
            pageSize: 20,
          }}
          total={1}
          totalPages={1}
        />,
      );
    });

    const headerCells = [...container.querySelectorAll("thead th")];
    const bodyCells = [...container.querySelectorAll("tbody td")];

    for (const cells of [headerCells, bodyCells]) {
      expect(cells[0]?.className).toContain("before:right-0");
      expect(cells[0]?.className).toContain("before:bg-border");
      expect(cells[3]?.className).toContain("before:left-0");
      expect(cells[3]?.className).toContain("before:bg-border");
    }
  });
});
