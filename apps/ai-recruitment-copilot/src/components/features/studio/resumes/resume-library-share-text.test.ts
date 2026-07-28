import { describe, expect, it } from "vitest";

import { buildResumeDetailShareText } from "./resume-library-page-model";

describe("buildResumeDetailShareText", () => {
  const link = "https://example.com/resume-review/workspace/resume-1";

  it("appends the recommendation after a blank line", () => {
    expect(buildResumeDetailShareText(link, "推荐进入下一轮")).toBe(`${link}\n\n推荐进入下一轮`);
  });

  it.each([null, "", "   "])("keeps the current link-only text for %j", (recommendation) => {
    expect(buildResumeDetailShareText(link, recommendation)).toBe(link);
  });
});
