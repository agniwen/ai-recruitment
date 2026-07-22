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

  it("adds permission-gated identity editing without dropping fork-only summary fields", () => {
    expect(source).toContain("canEditResumeRecord(detail.resumeParseStatus)");
    expect(source).toContain("updateStudioResumeIdentity");
    expect(source).toContain('aria-label="编辑候选人信息"');
    expect(source).toContain('<SelectItem value="unreviewed">未评估</SelectItem>');
    expect(source.match(/label="目标岗位"/g)).toHaveLength(2);
    expect(source.match(/label="用人组织"/g)).toHaveLength(2);
    expect(source).toContain("detail.recommendationText");
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
