import { describe, expect, it } from "vitest";
import type { JobDescriptionGoogleSheetsSyncResult } from "@arc/shared/job-descriptions";

import { buildGoogleSheetSyncResultDescription } from "./google-sheets-sync-button";

function result(
  overrides: Partial<JobDescriptionGoogleSheetsSyncResult> = {},
): JobDescriptionGoogleSheetsSyncResult {
  return {
    departmentsCreated: 0,
    hiringUnitsCreated: 0,
    jobsCreated: 0,
    jobsUnchanged: 0,
    jobsUpdated: 0,
    processedRows: 0,
    skipped: [],
    warnings: [],
    ...overrides,
  };
}

describe("buildGoogleSheetSyncResultDescription", () => {
  it("summarizes counts and lists skip reasons with row numbers", () => {
    const text = buildGoogleSheetSyncResultDescription(
      result({
        departmentsCreated: 1,
        hiringUnitsCreated: 1,
        jobsCreated: 2,
        jobsUnchanged: 3,
        jobsUpdated: 1,
        processedRows: 8,
        skipped: [
          {
            code: "待生成",
            reason: "岗位唯一编码缺失或格式无效。",
            rowNumber: 2,
          },
          {
            code: "REQ-000010",
            reason: "缺少必填字段：编制组织。",
            rowNumber: 4,
          },
        ],
        warnings: [
          {
            code: "REQ-000020",
            field: "部门",
            message: "部门为空，已归入「默认部门」。",
            rowNumber: 5,
          },
        ],
      }),
    );

    expect(text).toContain("处理 8 行（导入/更新 3，未变化 3，跳过 2）");
    expect(text).toContain("用人组织新增 1，部门新增 1");
    expect(text).toContain("岗位新增 2，岗位更新 1");
    expect(text).toContain("跳过 2 条：");
    expect(text).toContain("第 2 行（待生成）：岗位唯一编码缺失或格式无效。");
    expect(text).toContain("第 4 行（REQ-000010）：缺少必填字段：编制组织。");
    expect(text).toContain("警告 1 条：");
    expect(text).toContain("第 5 行（REQ-000020） 部门：部门为空，已归入「默认部门」。");
  });

  it("caps long skip lists and reports how many remain hidden", () => {
    const skipped = Array.from({ length: 25 }, (_, index) => ({
      code: `REQ-${String(index + 1).padStart(6, "0")}`,
      reason: "岗位唯一编码在表格中重复。",
      rowNumber: index + 2,
    }));
    const text = buildGoogleSheetSyncResultDescription(
      result({
        processedRows: 25,
        skipped,
      }),
    );

    expect(text).toContain("跳过 25 条：");
    expect(text).toContain("· …另有 5 条未展开");
    expect(text.split("\n").filter((line) => line.startsWith("· 第"))).toHaveLength(20);
  });
});
