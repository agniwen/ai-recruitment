// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGrid } from "@/components/data-grid/data-grid";
import type { DataGridColumnDef } from "@/components/data-grid/data-grid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Row {
  id: string;
  name: string;
}

const columns: DataGridColumnDef<Row>[] = [{ accessorKey: "name", header: "姓名" }];

function renderGrid({
  data = [],
  loading = false,
  paginated = true,
}: {
  data?: Row[];
  loading?: boolean;
  paginated?: boolean;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <DataGrid
        columns={columns}
        data={data}
        empty={<p>暂无记录</p>}
        getRowId={(row) => row.id}
        loading={loading}
        pagination={
          paginated
            ? {
                onPageChange: vi.fn(),
                onPageSizeChange: vi.fn(),
                page: 1,
                pageSize: 20,
              }
            : undefined
        }
        total={data.length}
        totalPages={data.length > 0 ? 1 : 0}
      />,
    );
  });

  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("DataGrid initial loading", () => {
  it("shows a table skeleton before the first rows arrive", () => {
    const container = renderGrid({ loading: true });

    expect(container.querySelector('[data-slot="data-grid-skeleton"]')).not.toBeNull();
    expect(container.textContent).not.toContain("暂无记录");
  });

  it("keeps existing rows visible while loading", () => {
    const container = renderGrid({ data: [{ id: "1", name: "张三" }], loading: true });

    expect(container.querySelector('[data-slot="data-grid-skeleton"]')).toBeNull();
    expect(container.textContent).toContain("张三");
  });

  it("shows the empty state after an empty initial request finishes", () => {
    const container = renderGrid({ loading: false });

    expect(container.querySelector('[data-slot="data-grid-skeleton"]')).toBeNull();
    expect(container.textContent).toContain("暂无记录");
  });

  it("renders all supplied rows without pagination controls when pagination is omitted", () => {
    const container = renderGrid({
      data: [
        { id: "1", name: "张三" },
        { id: "2", name: "李四" },
      ],
      paginated: false,
    });

    expect(container.textContent).toContain("张三");
    expect(container.textContent).toContain("李四");
    expect(container.querySelector('[data-slot="pagination"]')).toBeNull();
  });
});
