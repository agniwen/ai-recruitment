import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DashboardPageSkeleton,
  GlobalConfigPageSkeleton,
  InterviewDetailPageSkeleton,
  JobDescriptionsPageSkeleton,
  MembersPageSkeleton,
  PermissionsPageSkeleton,
  ProfilePageSkeleton,
  RecruitingPageSkeleton,
  ResumePoolPageSkeleton,
  StudioTablePageSkeleton,
} from "./studio-page-skeletons";

describe("Studio page skeletons", () => {
  it.each([
    ["候选人管理", () => <RecruitingPageSkeleton />],
    ["简历池", () => <ResumePoolPageSkeleton />],
    ["AI 面试管理", () => <StudioTablePageSkeleton label="AI 面试管理" summary />],
    ["用人组织", () => <StudioTablePageSkeleton label="用人组织" />],
    ["招聘看板", () => <DashboardPageSkeleton />],
    ["在招岗位", () => <JobDescriptionsPageSkeleton />],
    ["个人中心", () => <ProfilePageSkeleton />],
    ["成员与招聘组", () => <MembersPageSkeleton />],
    ["角色与权限", () => <PermissionsPageSkeleton />],
    ["公司信息与话术", () => <GlobalConfigPageSkeleton />],
    ["面试详情", () => <InterviewDetailPageSkeleton />],
  ])("renders an accessible %s loading state", (label, createSkeleton) => {
    const html = renderToStaticMarkup(createSkeleton());

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`aria-label="${label}加载中"`);
  });

  it("matches the responsive layout relationships of the real pages", () => {
    const recruiting = renderToStaticMarkup(<RecruitingPageSkeleton />);
    const resumePool = renderToStaticMarkup(<ResumePoolPageSkeleton />);
    const dashboard = renderToStaticMarkup(<DashboardPageSkeleton />);
    const profile = renderToStaticMarkup(<ProfilePageSkeleton />);
    const permissions = renderToStaticMarkup(<PermissionsPageSkeleton />);

    expect(recruiting).toContain("lg:grid-cols-3");
    expect(recruiting).toContain("h-[702px] w-full");
    expect(resumePool).toContain("lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4");
    expect(dashboard).toContain("grid-cols-2 gap-4 xl:grid-cols-4");
    expect(dashboard).toContain("xl:grid-cols-[minmax(0,1fr)_24rem]");
    expect(profile).toContain("max-w-2xl");
    expect(permissions).toContain("min-w-[72rem]");
  });
});
