import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "../..");

function readSource(relativePath: string) {
  return readFileSync(path.join(srcRoot, relativePath), "utf-8");
}

describe("TanStack Start studio resumes migration", () => {
  it("registers the studio resumes route in the generated route tree", () => {
    expect(readSource("routeTree.gen.ts")).toContain("'/w/$slug/studio/resumes'");
  });

  it("registers the member review detail route in the generated route tree", () => {
    const routeTree = readSource("routeTree.gen.ts");

    expect(routeTree).toContain("'/resume-review/$slug/$recordId'");
    expect(routeTree).toContain("'/w/$slug/studio/resumes/$recordId'");
  });

  it("restores the recruiter resume list after closing a workspace detail page", () => {
    const detailSource = readSource("routes/w.$slug.studio.resumes.$recordId.tsx");
    const listSource = readSource("routes/w.$slug.studio.resumes.tsx");
    const studioShellSource = readSource("routes/w.$slug.studio.tsx");

    expect(detailSource).toContain("locationState.fromRecruiterResumeList");
    expect(detailSource).toContain("router.history.canGoBack()");
    expect(detailSource).toContain("router.history.back();");
    expect(listSource).toContain("useElementScrollRestoration");
    expect(listSource).toContain("STUDIO_MAIN_SCROLL_RESTORATION_ID");
    expect(listSource).toContain("useResumeLibraryInitialScrollRestore");
    expect(listSource).toContain("initialMeasurementsCache: canUseInitialMeasurements");
    expect(listSource).toContain("measurements: virtualizer.takeSnapshot()");
    expect(listSource).toContain("useResumeLibraryResizeScrollRestore({");
    expect(listSource).toContain('virtualizer.scrollToIndex(recordIndex, { align: "start" })');
    expect(listSource).toContain(
      "virtualizer.scrollToOffset(scrollElement.scrollTop + correction)",
    );
    expect(listSource).toContain("fromRecruiterResumeList: true");
    expect(studioShellSource).toContain("STUDIO_MAIN_SCROLL_RESTORATION_ID");
    expect(studioShellSource).toContain("scrollRestorationId={STUDIO_MAIN_SCROLL_RESTORATION_ID}");
  });

  it("uses the candidate name in the recruiter resume detail document title", () => {
    const source = readSource("routes/w.$slug.studio.resumes.$recordId.tsx");

    expect(source).toContain("function getRecruiterResumeDocumentTitle(");
    expect(source).toContain("const documentTitle = getRecruiterResumeDocumentTitle");
    expect(source).toContain("document.title = documentTitle;");
    expect(source).toContain('meta: [{ title: "候选人详情" }]');
  });

  it("keeps the migrated resumes route and page free of Next runtime imports", () => {
    const sources = [
      readSource("routes/w.$slug.studio.resumes.tsx"),
      readSource("routes/resume-review.$slug.$recordId.tsx"),
    ];

    expect(sources.join("\n")).not.toMatch(/next\/(?:dynamic|navigation|headers|server|cache)/u);
  });

  it("shows a tooltip on unsupported resume preview file icons", () => {
    const source = readSource("components/features/studio/resumes/resume-library-card.tsx");

    expect(source).toContain("UnsupportedResumeDocumentPreviewTooltip");
  });

  it("adds a permission-scoped copy detail link action to resume-library rows", () => {
    const routeSource = readSource("routes/w.$slug.studio.resumes.tsx");
    const cardSource = readSource("components/features/studio/resumes/resume-library-card.tsx");
    const source = `${routeSource}\n${cardSource}`;

    expect(source).toContain("copyResumeDetailLink");
    expect(source).toContain("复制详情链接");
    expect(source).toMatch(/`\/resume-review\/\$\{slug\}\/\$\{record\.id\}`/u);
    expect(source).not.toMatch(/`\/w\/\$\{slug\}\/studio\/resumes\/\$\{record\.id\}`/u);
    expect(source).toContain("record.createdBy === currentUserId");
    expect(source).toContain("canCopyResumeDetailLink");
  });

  it("uses a standalone member review page with only the detail title in the header", () => {
    const source = readSource("routes/resume-review.$slug.$recordId.tsx");

    expect(source).toContain("StudioPersonDetailPanel");
    expect(source).toContain('accessMode="review"');
    expect(source).toContain('layoutMode="page"');
    expect(source).toContain("shell={({ body, title })");
    expect(source).toContain("<h1");
    expect(source).toContain("{title}");
    expect(source).toContain("ResumeReviewEvaluationBar");
    expect(source).toContain("submitResumeReviewEvaluation");
    expect(source).toContain('createFileRoute("/resume-review/$slug/$recordId")');
    expect(source).toContain("<WorkspaceSlugProvider");
    expect(source).toContain("pb-[calc(7rem+env(safe-area-inset-bottom))]");
    expect(source).not.toContain("UserRoundIcon");
    expect(source).not.toContain("同工作区成员可查看该候选人的简历详情并提交一次评估。");
  });

  it("allows the review page for any authenticated user without workspace membership", () => {
    const source = readSource("routes/resume-review.$slug.$recordId.tsx");

    expect(source).toContain("getResumeReviewAccessState");
    expect(source).not.toContain("getWorkspaceAccessState");
    expect(source).not.toContain("NO_ACCESS_WORKSPACE_ROLE");
  });

  it("keeps the review detail page on document scrolling instead of modal internal scrolling", () => {
    const source = readSource("components/features/studio/studio-person-detail-panel.tsx");

    expect(source).toContain('layoutMode = "modal"');
    expect(source).toContain("const canUseTimelineRailScroll");
    expect(source).toContain('layoutMode === "modal"');
    expect(source).toContain('scrollMode={canUseTimelineRailScroll ? "internal" : "page"}');
    expect(source).toContain('canUseTimelineRailScroll ? "xl:overflow-hidden" : undefined');
  });

  it("shows the submitted resume evaluation status instead of disabled action buttons", () => {
    const source = readSource("routes/resume-review.$slug.$recordId.tsx");

    expect(source).toContain("const hasSubmittedEvaluation");
    expect(source).toContain("describeResumeEvaluationStatus(status)");
    expect(source).toContain("评估结果");
    expect(source).toContain("if (hasSubmittedEvaluation) {");
  });
});
