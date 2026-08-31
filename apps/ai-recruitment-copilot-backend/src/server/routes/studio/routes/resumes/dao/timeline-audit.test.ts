import { describe, expect, it } from "vitest";
import { auditDescription, auditMetadata, auditTitle, auditTone } from "./timeline-audit";

describe("resume evaluation audit timeline", () => {
  it("includes department and reason in evaluation activity copy", () => {
    expect(
      auditDescription(
        {
          departmentName: "研发部",
          reason: "符合岗位要求",
          toStatus: "pass",
        },
        "resume_evaluation_submitted",
      ),
    ).toBe("评估结果：通过，部门：研发部，原因：符合岗位要求");

    expect(
      auditDescription(
        {
          departmentName: "产品部",
          fromStatus: "fail",
          reason: "综合评估通过",
          toStatus: "pass",
        },
        "resume_evaluation_updated",
      ),
    ).toBe("评估状态：不通过 -> 通过，部门：产品部，原因：综合评估通过");
  });
});

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

describe("automatic related-candidate closure timeline", () => {
  const detail = {
    automaticClosure: true,
    fromOutcome: "in_pipeline",
    fromStage: "human_interview",
    matchKind: "semantic_similarity",
    reason: "高相似简历候选人「候选人甲」已录用（相似度 94%），系统自动结束流程。",
    similarityScore: 94,
    toOutcome: "archived",
    toStage: "closed",
    triggerCandidateId: "candidate-winner",
    triggerCandidateName: "候选人甲",
  };

  it("shows which candidate completed first and why this record was closed", () => {
    expect(auditTitle("candidate_transition", detail)).toBe("关联候选人录用，流程自动结束");
    expect(auditDescription(detail, "candidate_transition")).toBe(detail.reason);
    expect(auditMetadata(detail, "candidate_transition")).toEqual([
      { label: "触发候选人", value: "候选人甲" },
      { label: "触发记录 ID", value: "candidate-winner" },
      { label: "匹配方式", value: "简历相似度" },
      { label: "相似度", value: "94%" },
    ]);
  });
});
