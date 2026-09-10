import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { resumeReviewLooseSchema, resumeReviewV5Schema } from "@arc/db-schema/resume-review";
import { formatResumeReviewMarkdown } from "@arc/shared/resume-review";
import { ResumeReviewStructuredView } from "./resume-overview-panel";

vi.mock("@/components/ui/chart-radar", () => ({
  DimensionRadarChart: () => <div>评分雷达图</div>,
}));
vi.mock("@/lib/client/api", () => ({}));

const dimension = { rationale: "历史维度依据", score: 80 };
const legacy = {
  biasScan: { items: [] },
  dimensions: {
    educationBackground: dimension,
    experienceRelevance: dimension,
    potential: dimension,
    projectMatch: dimension,
    skillMatch: dimension,
    stability: dimension,
  },
  levelRecommendation: { level: "中级", rationale: "历史职级依据" },
  nextStep: {
    action: "interview",
    disclaimer: "以上为初步结论",
    interviewFocus: [],
    rationale: "历史行动依据",
  },
  overall: { baseScore: 80, conclusion: "历史结论", scoreRationale: "历史总分依据" },
  schemaVersion: 4,
  strengths: [{ evidence: "历史证据", impact: "历史影响", point: "历史优点" }],
  teamPositioning: { rationale: "历史团队依据", suggestion: "历史团队建议" },
  weaknesses: [{ evidence: null, impact: "待核实", point: "历史缺点" }],
};

function currentReview() {
  const currentDimension = { basis: "both", rationale: "项目实践的具体证据", score: 80 };
  return resumeReviewV5Schema.parse({
    detailedOverall: {
      judgment: "新版判断正文",
      matchingEvidence: "新版匹配事实",
      risks: "新版待确认问题",
    },
    dimensions: {
      educationBackground: { ...currentDimension, basis: "general" },
      experienceRelevance: currentDimension,
      potential: currentDimension,
      projectMatch: currentDimension,
      skillMatch: { ...currentDimension, basis: "job" },
      stability: currentDimension,
    },
    levelRecommendation: null,
    nextStep: legacy.nextStep,
    overall: { baseScore: 80, conclusion: "新版简明结论", scoreRationale: "六维加权" },
    schemaVersion: 5,
    teamPositioning: null,
    version: 5,
  });
}

describe("resume review version compatibility", () => {
  it.each([1, 2, 3, 4])(
    "reads and displays historical version %s without upgrading it",
    (schemaVersion) => {
      const stored = {
        ...legacy,
        overall:
          schemaVersion === 1
            ? { conclusion: "历史结论", score: 80, scoreRationale: "历史总分依据" }
            : legacy.overall,
        schemaVersion,
      };
      const review = resumeReviewLooseSchema.parse(stored);
      expect(review).toEqual(stored);
      expect(review).not.toHaveProperty("version");
      const html = renderToStaticMarkup(<ResumeReviewStructuredView review={review} />);
      expect(html).toContain("历史优点");
      expect(html).toContain("历史结论");
      expect(html).toContain("偏差扫描");
      expect(html).not.toContain("风险与待确认项");
      expect(formatResumeReviewMarkdown(review)).toContain("**优点**");
    },
  );

  it("renders new sections and numeric scores with explicit basis labels", () => {
    const review = currentReview();
    const html = renderToStaticMarkup(
      <ResumeReviewStructuredView review={review} screeningResultSlot={<div>筛选规则结果</div>} />,
    );
    for (const text of [
      "判断",
      "匹配依据",
      "风险与待确认项",
      "新版判断正文",
      "新版匹配事实",
      "新版待确认问题",
      "根据岗位要求和通用职业标准分析得出",
      "根据岗位要求分析得出",
      "根据通用职业标准分析得出",
      "综合评分",
      "80 / 100",
      "六维评价",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("偏差扫描");
    expect(html).not.toContain("筛选规则结果");
    expect(html).not.toContain("信息不足，待确认");
    expect(html).toContain('data-review-overall-supporting="true"');
    expect(html).not.toContain("非常推荐");
    expect(resumeReviewLooseSchema.parse(review)).toEqual(review);
  });

  it("retains previous results while regenerating or after failure", () => {
    const review = currentReview();
    const updating = renderToStaticMarkup(
      <ResumeReviewStructuredView
        review={review}
        status="processing"
        summaryAction={<button type="button">重新评估</button>}
      />,
    );
    const failed = renderToStaticMarkup(
      <ResumeReviewStructuredView error="模型超时" review={review} status="failed" />,
    );
    expect(updating).toContain("正在重新评价");
    expect(updating).toContain("新版简明结论");
    expect(updating).toContain("重新评估");
    expect(failed).toContain("模型超时");
    expect(failed).toContain("上一次已完成的结果");
    expect(failed).toContain("新版简明结论");
  });

  it("shows a compact empty state without legacy rule panels", () => {
    const html = renderToStaticMarkup(
      <ResumeReviewStructuredView
        review={null}
        screeningResultSlot={<div>筛选规则结果</div>}
        status="queued"
      />,
    );
    expect(html).toContain("正在生成 AI 评分");
    expect(html).not.toContain("筛选规则结果");
  });

  it("renders restricted emphasis and lists in the same panel layout as the reference", () => {
    const review = currentReview();
    review.detailedOverall.matchingEvidence = "1. **项目交付**\n2. *协作经验*";
    review.levelRecommendation = { level: "中级", rationale: "**独立交付**" };
    const html = renderToStaticMarkup(<ResumeReviewStructuredView review={review} />);
    expect(html).toContain("<strong>项目交付</strong>");
    expect(html).toContain("<em>协作经验</em>");
    expect(html).toContain("<ol>");
    expect(html).toContain("职级建议");
    expect(html).toContain("团队定位");
    expect(html).toContain("本次评价未提供团队定位建议，可重新评估生成。");
  });

  it("keeps both guidance panels below dimensions when stored V5 guidance is missing", () => {
    const html = renderToStaticMarkup(<ResumeReviewStructuredView review={currentReview()} />);
    expect(html).toContain("职级建议");
    expect(html).toContain("团队定位");
    expect(html).toContain("本次评价未提供职级建议，可重新评估生成。");
    expect(html.indexOf("职级建议")).toBeGreaterThan(html.indexOf("六维评价"));
  });

  it("does not silently downgrade malformed new results to legacy", () => {
    expect(
      resumeReviewLooseSchema.safeParse({ ...currentReview(), detailedOverall: null }).success,
    ).toBe(false);
    expect(resumeReviewLooseSchema.safeParse({ ...legacy, schemaVersion: 99 }).success).toBe(false);
  });
});
