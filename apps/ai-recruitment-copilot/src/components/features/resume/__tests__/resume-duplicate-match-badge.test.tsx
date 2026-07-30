import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResumeLifecycleBadge } from "@/components/features/studio/resumes/resume-lifecycle-badge";
import { ResumeDuplicateMatchBadge } from "../resume-duplicate-match-badge";

describe("ResumeDuplicateMatchBadge", () => {
  it("uses the same sizing and corner radius as the resume lifecycle badge", () => {
    const duplicateMarkup = renderToStaticMarkup(
      <ResumeDuplicateMatchBadge
        match={{
          count: 2,
          highestLevel: "high",
        }}
      />,
    );
    const lifecycleMarkup = renderToStaticMarkup(
      <ResumeLifecycleBadge fullLabel="简历筛选" stageLabel="简历筛选" tone="info" />,
    );

    for (const className of ["rounded-sm", "px-2.5", "py-1", "font-normal"]) {
      expect(duplicateMarkup).toContain(className);
      expect(lifecycleMarkup).toContain(className);
    }
    expect(duplicateMarkup).toContain("重复简历 2 条");
  });
});
