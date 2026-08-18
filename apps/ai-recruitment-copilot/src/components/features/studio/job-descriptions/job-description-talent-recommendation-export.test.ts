import type { JobDescriptionTalentRecommendation } from "@arc/shared/job-descriptions";
import { JOB_DESCRIPTION_TALENT_RECOMMENDATION_MAX_LIMIT } from "@arc/shared/job-descriptions";
import { describe, expect, it } from "vitest";
import {
  talentRecommendationDefaultColumnIds,
  talentRecommendationExportColumns,
} from "./job-description-talent-recommendation-export";

const recommendation: JobDescriptionTalentRecommendation = {
  candidateEmail: "lin@example.com",
  candidateName: "林一",
  candidatePhone: "13800000000",
  createdAt: "2026-01-02T00:00:00.000Z",
  currentJobDescriptionId: "jd-other",
  currentJobDescriptionName: "后端工程师",
  id: "candidate-1",
  masteredSkills: ["TypeScript", "PostgreSQL"],
  notes: "有招聘系统经验",
  profileHighlights: {
    educationItems: [{ level: "本科", major: "计算机", school: "浙江大学" }],
    educationLines: ["本科 浙江大学 · 计算机"],
    latestCompany: "Arc",
    latestCompanyDetail: { period: "2023-2026", role: "高级全栈工程师", summary: "负责推荐" },
    latestProject: "招聘推荐系统",
    latestProjectDetail: { period: "2025", role: "负责人", summary: "向量检索" },
    schools: ["浙江大学"],
  },
  reasons: ["技能与岗位要求相似", "命中技能：TypeScript、PostgreSQL"],
  resumeFileName: "lin-resume.pdf",
  resumeParseStatus: "ready",
  score: 82,
  similarity: {
    resumeOverview: 0.7,
    skillRole: 0.9,
    workProject: 0.8,
  },
  source: "resume_library",
  targetRole: "全栈工程师",
  workYears: 4,
};

function columnValue(id: string): boolean | number | string | null | undefined {
  const column = talentRecommendationExportColumns.find((item) => item.id === id);
  return column?.value(recommendation);
}

describe("talent recommendation export columns", () => {
  it("keeps the recommendation export cap at 50 rows", () => {
    expect(JOB_DESCRIPTION_TALENT_RECOMMENDATION_MAX_LIMIT).toBe(50);
  });

  it("exposes recommendation-specific columns that can be selected", () => {
    expect(talentRecommendationExportColumns.map((column) => column.id)).toEqual(
      expect.arrayContaining([
        "score",
        "reasons",
        "skillRole",
        "workProject",
        "resumeOverview",
        "source",
      ]),
    );
    expect(talentRecommendationDefaultColumnIds).toEqual(
      expect.arrayContaining(["candidateName", "score", "reasons", "source"]),
    );
  });

  it("serializes recommendation-only fields for the spreadsheet", () => {
    expect(columnValue("source")).toBe("候选人管理");
    expect(columnValue("score")).toBe(82);
    expect(columnValue("reasons")).toBe("技能与岗位要求相似；命中技能：TypeScript、PostgreSQL");
    expect(columnValue("skillRole")).toBe("90%");
    expect(columnValue("workProject")).toBe("80%");
    expect(columnValue("resumeOverview")).toBe("70%");
    expect(columnValue("latestCompany")).toBe("Arc");
    expect(columnValue("latestProject")).toBe("招聘推荐系统");
    expect(columnValue("education")).toBe("本科 浙江大学 · 计算机");
    expect(columnValue("workYears")).toBe(4);
  });
});
