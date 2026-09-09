import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResumeProfile } from "@arc/db-schema/interview/types";
import { ResumeProfileView } from "../resume-profile-view";

describe("incomplete resume display", () => {
  it("renders surviving information with whole objects and lists missing", () => {
    const profile = {
      educationExperiences: [null, { school: "某大学" }],
      name: "候选人",
      projectExperiences: [null, { name: "招聘项目", techStack: null }],
      workExperiences: null,
    } as unknown as ResumeProfile;
    const html = renderToStaticMarkup(<ResumeProfileView profile={profile} />);
    expect(html).toContain("候选人");
    expect(html).toContain("某大学");
    expect(html).toContain("招聘项目");
  });
  it("renders an empty parsed object safely", () => {
    expect(renderToStaticMarkup(<ResumeProfileView profile={{} as ResumeProfile} />)).toContain(
      "工作经历",
    );
  });
  it("keeps the no-profile empty state", () => {
    expect(renderToStaticMarkup(<ResumeProfileView profile={null} />)).toContain("暂无结构化简历");
  });
});
