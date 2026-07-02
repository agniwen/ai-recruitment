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

  it("shows candidate identity in the card without mailto table text", () => {
    expect(cardSource).toContain("{record.candidateName}");
    expect(cardSource).toContain("formatResumeCardContact(record.candidateEmail");
    expect(cardSource).not.toContain("mailto:");
  });

  it("shows row details directly in the candidate card", () => {
    expect(cardSource).toContain("record.candidateEmail");
    expect(cardSource).toContain("record.candidatePhone");
    expect(cardSource).toContain("getResumeLibraryJobDescriptionLabel(record)");
    expect(cardSource).toContain("record.creatorName");
    expect(cardSource).toContain("record.createdAt");
    expect(cardSource).toContain("lifecycle.fullLabel");
  });
});
