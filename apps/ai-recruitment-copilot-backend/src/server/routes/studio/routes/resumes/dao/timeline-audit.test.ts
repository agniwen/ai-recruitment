import { describe, expect, it } from "vitest";
import { auditDescription, auditMetadata, auditTitle, auditTone } from "./timeline-audit";

describe("candidate information audit timeline", () => {
  it("renders the latest displayed candidate information as structured metadata", () => {
    const detail = {
      age: 31,
      candidateEmail: "",
      candidateName: "郭靖",
      candidatePhone: "13900000000",
      gender: "男",
      hiringUnitId: "unit-1",
      hiringUnitName: "研发中心",
      jobDescriptionId: "job-1",
      jobDescriptionName: "后端工程师",
      recommendationText: "项目经验扎实",
      resumeEvaluationStatus: "pass",
      targetRole: "资深后端工程师",
      workYears: 8,
    };

    expect(auditTitle("candidate_information_updated", detail)).toBe("候选人信息已更新");
    expect(auditDescription(detail, "candidate_information_updated")).toBe("已保存最新候选人信息");
    expect(auditTone("candidate_information_updated")).toBe("info");
    expect(auditMetadata(detail, "candidate_information_updated")).toEqual([
      { label: "姓名", value: "郭靖" },
      { label: "目标岗位", value: "资深后端工程师" },
      { label: "关联岗位", value: "后端工程师" },
      { label: "用人组织", value: "研发中心" },
      { label: "简历评估", value: "通过" },
      { label: "性别", value: "男" },
      { label: "年龄", value: "31" },
      { label: "工作年限", value: "8" },
      { label: "邮箱", value: "未填写" },
      { label: "电话", value: "13900000000" },
      { label: "推荐语", value: "项目经验扎实" },
    ]);
  });

  it("keeps every displayed field in legacy snapshots with explicit empty labels", () => {
    expect(
      auditMetadata(
        {
          candidateName: "候选人",
          resumeEvaluationStatus: null,
        },
        "candidate_information_updated",
      ),
    ).toEqual([
      { label: "姓名", value: "候选人" },
      { label: "目标岗位", value: "未填写" },
      { label: "关联岗位", value: "未绑定岗位" },
      { label: "用人组织", value: "未分配用人组织" },
      { label: "简历评估", value: "未评估" },
      { label: "性别", value: "未填写" },
      { label: "年龄", value: "未填写" },
      { label: "工作年限", value: "未填写" },
      { label: "邮箱", value: "未填写" },
      { label: "电话", value: "未填写" },
      { label: "推荐语", value: "未填写" },
    ]);
  });
});
