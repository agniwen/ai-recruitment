import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../w.$slug.studio.resumes.tsx", import.meta.url), "utf-8");
const cardSource = readFileSync(
  new URL("../../components/features/studio/resumes/resume-library-card.tsx", import.meta.url),
  "utf-8",
);

describe("ResumeLibraryPage duplicate badges", () => {
  it("opens duplicate match details from resume library badges", () => {
    expect(source).toContain("ResumeDuplicateMatchesDialog");
    expect(source).toContain("fetchStudioResumeDuplicateMatches");
    expect(source).toContain("onShowDuplicateMatches={setDuplicateMatchRecord}");
    expect(cardSource).toContain("duplicateMatchBadge(record");
    expect(cardSource).toContain("onShowDuplicateMatches(record)");
  });

  it("shows candidate identity in the card without contact links", () => {
    expect(cardSource).toContain("{record.candidateName}");
    expect(cardSource).toContain("formatResumeRecordDisplayId(record.id)");
    expect(cardSource).not.toContain("mailto:");
    expect(cardSource).not.toContain("tel:");
  });

  it("shows recruiting context and the next-step review recommendation in the candidate card", () => {
    expect(cardSource).not.toContain('label="邮箱"');
    expect(cardSource).not.toContain('label="电话"');
    expect(cardSource).toContain("getResumeLibraryJobDescriptionLabel(record)");
    expect(cardSource).toContain("record.creatorName");
    expect(cardSource).toContain("record.createdAt");
    expect(cardSource).toContain("lifecycle.fullLabel");
    expect(cardSource).toContain("record.hiringUnitName");
    expect(cardSource).toContain("record.resumeEvaluatorName");
    expect(cardSource).toContain("describeResumeLibraryReviewCard");
    expect(cardSource).toContain("record.resumeReviewBaseScore");
    expect(cardSource).toContain("record.resumeReviewNextStepAction");
    expect(cardSource).toContain('label="下一步建议"');
  });
});
