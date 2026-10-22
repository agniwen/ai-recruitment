import { describe, expect, it } from "vitest";
import { parseSscResponsibilityRows, readSscResponsibilityFile } from "./import-file";

describe("SSC responsibility import file", () => {
  it("reads an actual Excel file including merged owner cells without shifting row numbers", async () => {
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("SSC负责组织");
    sheet.addRow(["需求对接负责人", "中心/部门", "SSC-花名", "SSC-tg", "SSC-邮箱", "备注"]);
    sheet.addRow(["负责人", "COE", "甲", "@one", "one@example.com", ""]);
    sheet.addRow(["", "待关联中心", "乙", "@two", "", "待补邮箱"]);
    sheet.mergeCells("A2:A3");
    const bytes = await workbook.xlsx.writeBuffer();
    const file = new File([bytes as BlobPart], "ssc.xlsx");
    expect(await readSscResponsibilityFile(file)).toMatchObject([
      {
        centerName: "COE",
        demandOwner: "负责人",
        departmentName: "",
        email: "one@example.com",
        row: 2,
        serviceUnit: "",
        telegram: "@one",
      },
      { centerName: "待关联中心", demandOwner: "负责人", email: "", row: 3, telegram: "@two" },
    ]);
  });
  it("reads the existing workbook headers, retaining incomplete contacts and blank lines", () => {
    expect(
      parseSscResponsibilityRows([
        ["需求对接负责人", "中心/部门", "SSC-花名", "SSC-tg", "SSC-邮箱", "备注"],
        ["  负责人  ", " 墨链 ", "子亦", "@ssc", "", "待补邮箱"],
        [],
        ["", "SZ公司", "", "", "", "暂无 SSC"],
      ]),
    ).toEqual([
      {
        centerName: "墨链",
        demandOwner: "负责人",
        departmentName: "",
        email: "",
        notes: "待补邮箱",
        row: 2,
        serviceUnit: "",
        sscName: "子亦",
        telegram: "@ssc",
      },
      {
        centerName: "SZ公司",
        demandOwner: "",
        departmentName: "",
        email: "",
        notes: "暂无 SSC",
        row: 4,
        serviceUnit: "",
        sscName: "",
        telegram: "",
      },
    ]);
  });

  it("requires the center header and keeps spreadsheet row numbers", () => {
    expect(() => parseSscResponsibilityRows([["SSC 邮箱"], ["ssc@example.com"]])).toThrow(
      "中心/部门",
    );
    expect(parseSscResponsibilityRows([["中心/部门"], [""], ["COE"]])[0].row).toBe(3);
  });

  it("maps department and service unit independently of the original center column", () => {
    expect(
      parseSscResponsibilityRows([
        ["部门", "入职服务单位", "中心/部门", "SSC邮箱"],
        ["  创意部 ", " 智能增长事业部 ", " 渠道中心 ", "ssc@example.com"],
      ]),
    ).toEqual([
      {
        centerName: "渠道中心",
        demandOwner: "",
        departmentName: "创意部",
        email: "ssc@example.com",
        notes: "",
        row: 2,
        serviceUnit: "智能增长事业部",
        sscName: "",
        telegram: "",
      },
    ]);
    expect(() =>
      parseSscResponsibilityRows([
        ["部门", "服务单位"],
        ["创意部", "事业部"],
      ]),
    ).toThrow("中心/部门");
  });

  it("rejects empty and oversized batches before preview", () => {
    expect(() => parseSscResponsibilityRows([["中心/部门"]])).toThrow("1 至 500");
    expect(() =>
      parseSscResponsibilityRows([["中心/部门"], ...Array.from({ length: 501 }, () => ["COE"])]),
    ).toThrow("500");
  });

  it("rejects unsupported files and over 5 MB files", async () => {
    await expect(readSscResponsibilityFile(new File([""], "data.csv"))).rejects.toThrow(".xlsx");
    await expect(
      readSscResponsibilityFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "data.xlsx")),
    ).rejects.toThrow("5 MB");
  });

  it("reads BOM TSV text through the same field mapping", async () => {
    const file = new File(["\uFEFF中心/部门\tSSC 邮箱\nCOE\tSSC@EXAMPLE.COM"], "data.tsv");
    expect(await readSscResponsibilityFile(file)).toMatchObject([
      { centerName: "COE", email: "SSC@EXAMPLE.COM", row: 2 },
    ]);
  });
});
