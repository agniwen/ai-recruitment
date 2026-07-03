import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../resume-library-card.tsx", import.meta.url), "utf-8");

describe("ResumeLibraryCard", () => {
  it("uses the shared control surface material without a table frame", () => {
    expect(source).toContain("function ResumeLibraryCardComponent");
    expect(source).toContain("export const ResumeLibraryCard = memo(");
    expect(source).toContain("border border-input bg-background bg-clip-padding");
    expect(source).toContain("shadow-xs/5");
    expect(source).toContain("before:shadow-[0_1px_--theme(--color-black/4%)]");
    expect(source).toContain("dark:before:shadow-[0_-1px_--theme(--color-white/6%)]");
    expect(source).not.toContain("bg-muted p-1");
  });

  it("puts a resume file preview action before the detail action", () => {
    const actionsSource = source.slice(
      source.indexOf("function ResumeLibraryCardActions("),
      source.indexOf("function ResumeLibraryCardComponent("),
    );

    expect(actionsSource).toContain("ResumeLibraryPreviewAction");
    expect(source).toContain("getResumeDocumentFileIconKind");
    expect(source).toContain("record.hasResumeFile && previewable");
    expect(source).toContain("UnsupportedResumeDocumentPreviewTooltip");
    expect(actionsSource.indexOf("<ResumeLibraryPreviewAction")).toBeLessThan(
      actionsSource.indexOf('label="查看"'),
    );
  });

  it("surfaces interviewer and evaluator metadata on the card", () => {
    expect(source).toContain("formatResumeCardAiInterviewers");
    expect(source).toContain("formatResumeCardHumanInterviewers");
    expect(source).toContain("grid grid-cols-1 gap-x-4 gap-y-1.5");
    expect(source).not.toContain("ResumeCardMetaSeparator");
    expect(source).not.toContain("关联岗位：");
    expect(source).toContain("ResumeLibraryCardMoreMenu");
    expect(source).toContain("record.jobDescriptionInterviewers");
    expect(source).toContain("record.humanInterviewers");
    expect(source).toContain("record.resumeEvaluatorName");
    expect(source).toContain("describeResumeEvaluationStatus(record.resumeEvaluationStatus)");
    expect(source).toContain("评估：");
    expect(source).toContain("评估人：");
    expect(source).toContain("AI 面试官：");
    expect(source).toContain("真人面试官：");
  });

  it("requires passed resume evaluation before showing the AI interview action", () => {
    expect(source).toContain("getResumeInterviewGateReason(record.resumeEvaluationStatus)");
    expect(source).toContain("resumeInterviewGateReason === null");
  });
});
