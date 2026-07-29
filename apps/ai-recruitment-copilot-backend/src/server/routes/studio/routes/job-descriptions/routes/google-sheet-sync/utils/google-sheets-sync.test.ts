import { describe, expect, it } from "vitest";
import {
  buildGoogleSheetJobValues,
  DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME,
  hasGoogleSheetJobChanges,
  parseGoogleSheetJobRows,
} from "./google-sheets-sync";

const HEADERS = [
  "岗位名称",
  "编制组织",
  "招聘状态",
  "岗位管控分类",
  "序列",
  "职级",
  "服务单位",
  "部门",
  "HC",
  "已到岗",
  "缺口",
  "已发offer待入职",
  "提需日期",
  "期望到岗日期",
  "优先级",
  "需求发起人",
  "简历对接人\n (花名 & @TG)",
  "JD(必填) 岗位职责+任职要求",
  "薪资范围",
  "备注说明\n非远程岗位请备注说明工作地点",
  "来源表格",
  "工作地点",
  "稳定唯一值",
];

function row(overrides: Partial<Record<(typeof HEADERS)[number], string>> = {}) {
  const values: Record<string, string> = {
    HC: "3",
    "JD(必填) 岗位职责+任职要求": "负责平台研发",
    优先级: "P1（中）",
    "备注说明\n非远程岗位请备注说明工作地点": "备注",
    岗位名称: "高级后端工程师",
    岗位管控分类: "C类-正常招聘",
    工作地点: "远程",
    已到岗: "1",
    已发offer待入职: "",
    序列: "直属",
    招聘状态: "招聘中",
    提需日期: "2026.7.25",
    服务单位: "天枢",
    期望到岗日期: "尽快",
    来源表格: "技术中心",
    稳定唯一值: "REQ-000006",
    "简历对接人\n (花名 & @TG)": "对接人",
    编制组织: " 技术中心 ",
    缺口: "2",
    职级: "P4-P5",
    薪资范围: "15-25K",
    部门: "平台组",
    需求发起人: "发起人",
  };
  return HEADERS.map((header) => overrides[header] ?? values[header] ?? "");
}

describe("parseGoogleSheetJobRows", () => {
  it("normalizes a valid row and keeps unsupported salary text out of mapped values", () => {
    const result = parseGoogleSheetJobRows([HEADERS, row()]);

    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toContainEqual({
      code: "REQ-000006",
      field: "期望到岗日期",
      message: "无法识别日期“尽快”，新岗位将留空，已有岗位保留原值。",
      rowNumber: 2,
    });
    expect(result.records[0]).toMatchObject({
      code: "REQ-000006",
      departmentName: "平台组",
      expectedOnboardDate: undefined,
      headcount: 3,
      hiringUnitName: "技术中心",
      name: "高级后端工程师",
      priority: "P1",
      prompt: "负责平台研发",
      requestedDate: "2026-07-25",
      salaryRangeRaw: "15-25K",
    });
  });

  it("skips placeholder codes, missing hierarchy, and every duplicate code", () => {
    const result = parseGoogleSheetJobRows([
      HEADERS,
      row({ 稳定唯一值: "待生成" }),
      row({ 稳定唯一值: "REQ-000010", 编制组织: "" }),
      row({ 稳定唯一值: "REQ-000012" }),
      row({ 岗位名称: "重复岗位", 稳定唯一值: "REQ-000012" }),
    ]);

    expect(result.records).toEqual([]);
    expect(result.skipped.map((item) => item.rowNumber)).toEqual([2, 3, 4, 5]);
    expect(result.skipped.filter((item) => item.reason.includes("重复"))).toHaveLength(2);
  });

  it("imports rows with an empty JD prompt instead of skipping them", () => {
    const result = parseGoogleSheetJobRows([
      HEADERS,
      row({
        "JD(必填) 岗位职责+任职要求": "",
        稳定唯一值: "REQ-000011",
      }),
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      code: "REQ-000011",
      prompt: "",
    });
    expect(result.warnings).toContainEqual({
      code: "REQ-000011",
      field: "JD(必填) 岗位职责+任职要求",
      message: "JD 为空，已按空岗位说明导入。",
      rowNumber: 2,
    });
  });

  it("allows empty department cells and marks them as unspecified", () => {
    const result = parseGoogleSheetJobRows([
      HEADERS,
      row({ 稳定唯一值: "REQ-000020", 部门: "" }),
      row({ 稳定唯一值: "REQ-000021", 部门: "   " }),
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records.map((item) => item.departmentName)).toEqual([
      DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME,
      DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME,
    ]);
    expect(result.records.every((item) => item.departmentSpecified === false)).toBe(true);
    expect(result.warnings).toContainEqual({
      code: "REQ-000020",
      field: "部门",
      message: `部门为空：新建岗位归入「${DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME}」，已有岗位保留本系统部门；编制组织仍按表格写入。`,
      rowNumber: 2,
    });
    expect(result.warnings).toContainEqual({
      code: "REQ-000021",
      field: "部门",
      message: `部门为空：新建岗位归入「${DEFAULT_GOOGLE_SHEET_DEPARTMENT_NAME}」，已有岗位保留本系统部门；编制组织仍按表格写入。`,
      rowNumber: 3,
    });
  });

  it("keeps departmentSpecified true when the sheet provides a department", () => {
    const result = parseGoogleSheetJobRows([HEADERS, row({ 稳定唯一值: "REQ-000030" })]);
    expect(result.records[0]).toMatchObject({
      departmentName: "平台组",
      departmentSpecified: true,
    });
  });
});

describe("Google Sheet mapped job changes", () => {
  it("is idempotent when all mapped values are unchanged", () => {
    const [parsed] = parseGoogleSheetJobRows([HEADERS, row()]).records;
    const values = buildGoogleSheetJobValues(parsed, "department-1", "hiring-unit-1");

    expect(values.hiringUnitId).toBe("hiring-unit-1");
    expect(values.departmentId).toBe("department-1");
    expect(hasGoogleSheetJobChanges(values, values)).toBe(false);
    expect(
      hasGoogleSheetJobChanges(
        {
          ...values,
          name: "旧岗位名",
        },
        values,
      ),
    ).toBe(true);
    expect(
      hasGoogleSheetJobChanges(
        {
          ...values,
          hiringUnitId: "hiring-unit-old",
        },
        values,
      ),
    ).toBe(true);
  });

  it("omits departmentId on update when the sheet department cell is empty", () => {
    const [parsed] = parseGoogleSheetJobRows([
      HEADERS,
      row({ 稳定唯一值: "REQ-000040", 部门: "" }),
    ]).records;
    expect(parsed.departmentSpecified).toBe(false);

    // Update path: pass undefined departmentId so existing department is preserved.
    const updateValues = buildGoogleSheetJobValues(parsed, undefined, "hiring-unit-1");
    expect(updateValues.departmentId).toBeUndefined();
    expect(updateValues.hiringUnitId).toBe("hiring-unit-1");
    expect(
      hasGoogleSheetJobChanges(
        {
          controlCategory: updateValues.controlCategory,
          departmentId: "existing-department",
          expectedOnboardDate: null,
          gapCount: updateValues.gapCount,
          headcount: updateValues.headcount,
          hiringUnitId: "hiring-unit-1",
          jobLevel: updateValues.jobLevel,
          jobSeries: updateValues.jobSeries,
          name: updateValues.name,
          notes: updateValues.notes,
          offeredPendingOnboardCount: updateValues.offeredPendingOnboardCount,
          onboardedCount: updateValues.onboardedCount,
          priority: updateValues.priority,
          prompt: updateValues.prompt,
          recruitmentStatus: updateValues.recruitmentStatus,
          requestedDate: updateValues.requestedDate,
          requester: updateValues.requester,
          resumeContact: updateValues.resumeContact,
          salaryRangeRaw: updateValues.salaryRangeRaw,
          serviceUnit: updateValues.serviceUnit,
          sourceSheet: updateValues.sourceSheet,
          workLocation: updateValues.workLocation,
        },
        updateValues,
      ),
    ).toBe(false);

    // Create path: still writes the default department under the hiring unit.
    const createValues = buildGoogleSheetJobValues(parsed, "default-dept-id", "hiring-unit-1");
    expect(createValues.departmentId).toBe("default-dept-id");
  });
});
