import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("resume-overview-panel.tsx", import.meta.url), "utf-8");

describe("ResumeOverviewPanel visual density", () => {
  it("shows the AI score summary and structured candidate fields", () => {
    expect(source).toContain("<ResumeOverviewAiScoreSection");
    expect(source).toContain("<DimensionRadarChart compact");
    expect(source).toContain("<DataFields");
    expect(source).toContain("<DataField");
    expect(source).toContain('className="space-y-8"');
    expect(source).toContain("border-t border-border/50 pt-6");
    expect(source).not.toContain("SoftPanel");
  });

  it("shows the hiring unit in the resume summary", () => {
    expect(source).toContain('label="用人组织"');
    expect(source).toContain("detail.hiringUnitName");
  });

  it("shows read-only available time slots only when current evaluation is pass", () => {
    expect(source).toContain('label="可预约时间"');
    expect(source).toContain("detail.availableTimeSlots");
    expect(source).toContain('detail.resumeEvaluationStatus === "pass"');
    expect(source).toContain("detail.availableTimeSlots.length > 0");
    expect(source).not.toContain('htmlFor="overview-available-time');
  });

  it("adds permission-gated identity editing without dropping fork-only summary fields", () => {
    expect(source).toContain("canEditResumeRecord(detail.resumeParseStatus)");
    expect(source).toContain("updateStudioResumeIdentity");
    expect(source).toContain('aria-label="编辑候选人信息"');
    expect(source).toContain('<SelectItem value="unreviewed">未评估</SelectItem>');
    expect(source).toContain('htmlFor="overview-target-role">目标岗位');
    expect(source).toContain('htmlFor="overview-hiring-unit"');
    expect(source).toContain('<DataField label="目标岗位"');
    expect(source).toContain('<DataField label="用人组织"');
    expect(source).toContain('htmlFor="overview-recommendation-text">推荐语');
    expect(source).toContain('label="推荐语"');
    expect(source).toContain("recommendationText: draft.recommendationText.trim()");
  });

  it("edits the hiring unit and target role and uses a number-only age input", () => {
    expect(source).toContain('id="overview-hiring-unit"');
    expect(source).toContain('id="overview-target-role"');
    expect(source).toContain("hiringUnitId: draft.hiringUnitId");
    expect(source).toContain("targetRole: draft.targetRole.trim()");
    expect(source).toMatch(/id="overview-age"[\s\S]*?type="number"/);
  });

  it("keeps AI parsed review out of the overview summary area", () => {
    const overviewBody = source.slice(source.indexOf("export function ResumeOverviewPanel"));

    expect(overviewBody).not.toContain("<ResumeReviewStructuredView");
  });

  it("uses the weighted radar layout for AI review details", () => {
    const reviewSource = source.slice(
      source.indexOf("export function ResumeReviewStructuredView"),
      source.indexOf("export function ResumeOverviewPanel"),
    );

    expect(reviewSource).toContain('className="w-full space-y-6"');
    expect(reviewSource).toContain("<DimensionRadarChart dimensions={dimensionScores}");
    expect(reviewSource).toContain("<DimensionScoreGroup");
    expect(reviewSource).toContain("screeningResultSlot");
    expect(reviewSource).toContain("summaryAction");
    expect(reviewSource).toContain("ReviewSectionHeader");
  });

  it("uses unified frame surfaces for AI review sections", () => {
    const reviewSource = source.slice(
      source.indexOf("export function ResumeReviewStructuredView"),
      source.indexOf("export function ResumeOverviewPanel"),
    );

    expect(reviewSource).toContain("<Frame>");
    expect(reviewSource).toContain("<FramePanel");
    expect(reviewSource).not.toContain("rounded-2xl bg-muted/20");
  });
});
