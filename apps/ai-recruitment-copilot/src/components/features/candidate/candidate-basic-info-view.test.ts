import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateBasicInfoView } from "./candidate-basic-info-view";

describe("CandidateBasicInfoView", () => {
  it("renders candidate fields and a missing attachment without a preview action", () => {
    const html = renderToStaticMarkup(
      createElement(CandidateBasicInfoView, {
        candidateEmail: "zhang@example.com",
        candidateName: "张三",
        candidatePhone: null,
        creatorName: "招聘专员",
        hasResumeFile: false,
        jobDescriptionName: "研发岗",
        resumeFileName: null,
        targetRole: "前端工程师",
      }),
    );
    for (const text of [
      "姓名",
      "张三",
      "zhang@example.com",
      "前端工程师",
      "研发岗",
      "招聘专员",
      "暂无简历附件",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("预览简历");
  });
});
