import type { ColumnDef, RowData } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import type { DataGridFeatures } from "../table-features";

export function selectColumn<TData extends RowData>({
  getRowLabel,
  scopeLabel = "当前页",
}: {
  getRowLabel?: (row: TData) => string;
  scopeLabel?: string;
} = {}): ColumnDef<DataGridFeatures, TData> {
  return {
    cell: ({ row }) => {
      const rowLabel = getRowLabel?.(row.original);
      return (
        <Checkbox
          aria-label={rowLabel ? `选择“${rowLabel}”` : "选择此行"}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      );
    },
    enableSorting: false,
    header: ({ table }) => {
      // Server-paginated grids only hold the current page in `data`, so
      // all-rows checks equal page-level selection. V9: "some" includes "all".
      const allSelected = table.getIsAllRowsSelected();
      const someSelected = table.getIsSomeRowsSelected();
      const hasSelectableRows = table.getRowModel().rows.some((row) => row.getCanSelect());
      return (
        <Checkbox
          aria-label={`全选${scopeLabel}`}
          checked={allSelected}
          disabled={!hasSelectableRows}
          indeterminate={someSelected && !allSelected}
          onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        />
      );
    },
    id: "select",
    // Must match rendered width so subsequent pinned columns' sticky offsets align.
    maxSize: 40,
    minSize: 40,
    size: 40,
  };
}
