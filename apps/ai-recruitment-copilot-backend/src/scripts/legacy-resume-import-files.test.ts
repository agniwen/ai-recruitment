import { describe, expect, it } from "vitest";
import { isSupportedLegacyResumeKey, legacyResumeFileName } from "./legacy-resume-import-files";

describe("legacy resume import files", () => {
  it.each([
    "resume.pdf",
    "resume.docx",
    "resume.ppt",
    "resume.pptx",
    "resume.jpg",
    "resume.jpeg",
    "resume.png",
  ])("accepts %s", (fileName) => {
    expect(isSupportedLegacyResumeKey(`dev/legacy-upload/${fileName}`)).toBe(true);
  });

  it.each(["resume.doc", "resume.json", "resume.zip", "resume.xlsx"])("rejects %s", (fileName) => {
    expect(isSupportedLegacyResumeKey(`dev/legacy-upload/${fileName}`)).toBe(false);
  });

  it("decodes the source file name", () => {
    expect(legacyResumeFileName("dev/legacy-upload/%E5%BC%A0%E4%B8%89.pdf")).toBe("张三.pdf");
  });
});
