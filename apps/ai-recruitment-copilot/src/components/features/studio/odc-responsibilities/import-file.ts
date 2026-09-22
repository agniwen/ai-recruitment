export interface ResponsibilityImportRow {
  email: string;
  name: string;
  center: string;
  departments: string;
}

async function readRows(file: File): Promise<string[][]> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("文件不能超过 5 MB。");
  }
  let rows: string[][];
  if (file.name.toLowerCase().endsWith(".xlsx")) {
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
    rows = [];
    sheet.eachRow((row) => {
      rows.push(
        Array.from({ length: Math.min(sheet.columnCount, 30) }, (_, i) =>
          row.getCell(i + 1).text.trim(),
        ),
      );
    });
  } else {
    const content = await file.text();
    rows = content
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("\t").map((v) => v.trim()));
  }
  return rows;
}

export function parseResponsibilityRows(rows: string[][]): ResponsibilityImportRow[] {
  const [headers, ...body] = rows;
  if (!headers) {
    throw new Error("文件为空。");
  }
  const find = (...names: string[]) => headers.findIndex((h) => names.includes(h.trim()));
  const email = find("邮箱", "Gmail", "Email");
  const name = find("姓名/花名", "姓名", "花名");
  const center = find("负责公司/团队/部门", "负责中心", "中心");
  const departments = find("负责部门/小组", "负责部门");
  if (email < 0 || center < 0 || departments < 0) {
    throw new Error("缺少表头：邮箱、负责公司/团队/部门、负责部门/小组。");
  }
  const values = body
    .filter((row) => row.some(Boolean))
    .map((row) => ({
      center: row[center] ?? "",
      departments: row[departments] ?? "",
      email: row[email] ?? "",
      name: name >= 0 ? (row[name] ?? "") : "",
    }));
  if (!values.length || values.length > 500) {
    throw new Error("请提供 1 至 500 行数据。");
  }
  return values;
}

export async function readResponsibilityFile(file: File): Promise<ResponsibilityImportRow[]> {
  return parseResponsibilityRows(await readRows(file));
}
