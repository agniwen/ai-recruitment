export interface SscResponsibilityImportRow {
  row: number;
  centerName: string;
  demandOwner: string;
  serviceUnit: string;
  departmentName: string;
  sscName: string;
  telegram: string;
  email: string;
  notes: string;
}

const HEADERS = {
  centerName: ["中心/部门", "部门/中心", "中心/部门（来源）", "部门/中心（来源）"],
  demandOwner: ["需求对接负责人", "需求负责人", "负责人"],
  departmentName: ["部门", "所属部门", "入职部门"],
  email: ["SSC邮箱", "邮箱", "Email"],
  notes: ["备注"],
  serviceUnit: ["服务单位", "入职服务单位"],
  sscName: ["SSC花名", "SSC姓名", "SSC", "姓名/花名"],
  telegram: ["SSCTG", "TG", "Telegram"],
};

const normalizeHeader = (value: string) => value.replaceAll(/[\s_-]/gu, "").toLowerCase();

export function parseSscResponsibilityRows(rows: string[][]): SscResponsibilityImportRow[] {
  const [headers, ...body] = rows;
  const indices = Object.fromEntries(
    Object.entries(HEADERS).map(([field, aliases]) => [
      field,
      headers?.findIndex((header) =>
        aliases.some((alias) => normalizeHeader(alias) === normalizeHeader(header)),
      ) ?? -1,
    ]),
  );
  if (indices.centerName < 0) {
    throw new Error("缺少表头：中心/部门。请下载模板填写后重新上传。");
  }
  const result = body.flatMap((cells, index) => {
    if (!cells.some((cell) => cell.trim())) {
      return [];
    }
    const value = (field: string) => (cells[indices[field]] ?? "").trim();
    return [
      {
        centerName: value("centerName"),
        demandOwner: value("demandOwner"),
        departmentName: value("departmentName"),
        email: value("email"),
        notes: value("notes"),
        row: index + 2,
        serviceUnit: value("serviceUnit"),
        sscName: value("sscName"),
        telegram: value("telegram"),
      },
    ];
  });
  if (!result.length || result.length > 500) {
    throw new Error("请提供 1 至 500 行数据。");
  }
  return result;
}

export async function readSscResponsibilityFile(file: File): Promise<SscResponsibilityImportRow[]> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("文件不能超过 5 MB。");
  }
  if (file.name.toLowerCase().endsWith(".tsv")) {
    const raw = await file.text();
    const content = raw.replace(/^\uFEFF/u, "");
    return parseSscResponsibilityRows(content.split(/\r?\n/u).map((line) => line.split("\t")));
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("请选择 Excel (.xlsx) 或 TSV (.tsv) 文件。");
  }
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const [sheet] = workbook.worksheets;
  if (!sheet) {
    throw new Error("文件没有工作表。");
  }
  if (sheet.rowCount > 501) {
    throw new Error("每次最多导入 500 行，请拆分文件。");
  }
  const rows = Array.from({ length: sheet.rowCount }, (_, index) =>
    Array.from({ length: Math.min(sheet.columnCount, 30) }, (_cell, column) =>
      sheet
        .getRow(index + 1)
        .getCell(column + 1)
        .text.trim(),
    ),
  );
  return parseSscResponsibilityRows(rows);
}
