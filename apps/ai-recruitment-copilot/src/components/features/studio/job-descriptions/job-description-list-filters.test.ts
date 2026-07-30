import { describe, expect, it } from "vitest";
import { createJobDescriptionListFilters } from "./job-description-list-filters";

describe("createJobDescriptionListFilters", () => {
  it("provides the requested job-description filters", () => {
    const filters = createJobDescriptionListFilters({
      departments: [],
      interviewers: [],
      recruitmentStatuses: ["招聘中", "暂停招聘"],
      sourceSheets: ["汇总表", "研发岗位"],
    });

    expect(filters.map((filter) => filter.key)).toEqual([
      "search",
      "code",
      "sourceSheet",
      "recruitmentStatus",
      "googleSheetStatus",
      "departmentId",
      "interviewerId",
    ]);
    const recruitmentStatusFilter = filters.find((filter) => filter.key === "recruitmentStatus");
    expect(recruitmentStatusFilter?.type).toBe("multi-select");
    if (!recruitmentStatusFilter || recruitmentStatusFilter.type === "search") {
      throw new Error("招聘状态筛选器配置无效");
    }
    expect(recruitmentStatusFilter.options).toEqual([
      { label: "招聘中", value: "招聘中" },
      { label: "暂停招聘", value: "暂停招聘" },
    ]);
    const sourceSheetFilter = filters.find((filter) => filter.key === "sourceSheet");
    expect(sourceSheetFilter?.type).toBe("select");
    if (!sourceSheetFilter || sourceSheetFilter.type === "search") {
      throw new Error("来源表格筛选器配置无效");
    }
    expect(sourceSheetFilter.options).toEqual([
      { label: "汇总表", value: "汇总表" },
      { label: "研发岗位", value: "研发岗位" },
    ]);
    expect(sourceSheetFilter.searchPlaceholder).toBe("搜索来源表格…");
  });
});
