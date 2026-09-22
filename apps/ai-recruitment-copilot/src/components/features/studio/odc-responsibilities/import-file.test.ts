import { describe, expect, it } from "vitest";
import { parseResponsibilityRows } from "./import-file";

describe("ODC spreadsheet headers", () => {
  const header = ["人员类型", "姓名/花名", "负责公司/团队/部门", "负责部门/小组", "邮箱", "TG"];
  it("reads screenshot columns without changing roles or Telegram", () => {
    expect(
      parseResponsibilityRows([
        header,
        ["ODC", "张三", "中心", "产品、研发", "a@example.com", "@tg"],
      ]),
    ).toEqual([
      { center: "中心", departments: "产品、研发", email: "a@example.com", name: "张三" },
    ]);
  });
  it("rejects missing headers, empty data and oversized imports", () => {
    expect(() => parseResponsibilityRows([["姓名"]])).toThrow("缺少表头");
    expect(() => parseResponsibilityRows([header])).toThrow("1 至 500");
    expect(() =>
      parseResponsibilityRows([header, ...Array.from({ length: 501 }, () => ["ODC"])]),
    ).toThrow("1 至 500");
  });
});
