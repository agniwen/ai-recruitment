import type { DataExportColumn } from "./data-export-model";

function safeFileName(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]/g, "-");
}

export async function downloadDataExportXlsx<T>({
  columns,
  fileName,
  rows,
  sheetName,
}: {
  columns: readonly DataExportColumn<T>[];
  fileName: string;
  rows: readonly T[];
  sheetName: string;
}): Promise<void> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.creator = "AI Recruitment Copilot";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));
  worksheet.columns = columns.map((column) => ({
    header: column.label,
    key: column.id,
    width: column.width ?? 18,
  }));
  for (const row of rows) {
    worksheet.addRow(
      Object.fromEntries(columns.map((column) => [column.id, column.value(row) ?? ""])),
    );
  }
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { column: 1, row: 1 },
    to: { column: columns.length, row: Math.max(rows.length + 1, 1) },
  };
  const header = worksheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  const bytes = await workbook.xlsx.writeBuffer();
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = `${safeFileName(fileName)}.xlsx`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}
