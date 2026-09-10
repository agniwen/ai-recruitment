import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "../..");

function readSource(relativePath: string) {
  return readFileSync(path.join(srcRoot, relativePath), "utf-8");
}

describe("TanStack Start shared component migration", () => {
  it("keeps shared components used by Start routes free of Next runtime imports", () => {
    const sources = [
      readSource("components/features/pdf/pdf-preview-button.tsx"),
      readSource("components/features/resume-import/resume-import-button.tsx"),
      readSource("components/features/candidate/candidate-basic-info-view.tsx"),
      readSource("components/features/studio/studio-switch-account-button.tsx"),
    ];

    expect(sources.join("\n")).not.toMatch(
      /next\/(?:dynamic|navigation|headers|server|cache|link)/u,
    );
  });

  it("routes PDF previews through the shared document modal", () => {
    const source = readSource("components/features/pdf/pdf-preview-button.tsx");
    expect(source).toContain("<ResumeDocumentPreviewModal");
    expect(source).toContain('kind="pdf"');
    expect(source).toContain("url={open && !disabled ? url : null}");
  });

  it("persists generated structured resume review through chat one-click import", () => {
    const buttonSource = readSource("components/features/resume-import/resume-import-button.tsx");
    const routeSource = readSource(
      "../../ai-recruitment-copilot-backend/src/server/routes/studio/routes/resumes/route.ts",
    );

    expect(buttonSource).toContain("buildSaveOnlyResumeFormData");
    expect(buttonSource).not.toContain("generateResumeReview");
    expect(routeSource).toContain("let resumeReview = resumeReviewInput.data");
    expect(routeSource).toContain("generateResumeReviewBestEffort");
    expect(routeSource).toContain("resumeReview = generatedReview?.structuredReview ?? null");
  });
});
