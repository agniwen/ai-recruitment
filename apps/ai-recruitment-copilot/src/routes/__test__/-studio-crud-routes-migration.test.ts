import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "../..");

function readSource(relativePath: string) {
  return readFileSync(path.join(srcRoot, relativePath), "utf-8");
}

describe("TanStack Start studio CRUD route migration", () => {
  const routes = [
    "/w/$slug/studio/hiring-units",
    "/w/$slug/studio/job-descriptions",
    "/w/$slug/studio/interviewers",
    "/w/$slug/studio/departments",
    "/w/$slug/studio/forms",
  ];

  it("registers migrated studio CRUD routes in the generated route tree", () => {
    const routeTree = readSource("routeTree.gen.ts");

    for (const route of routes) {
      expect(routeTree).toContain(`'${route}'`);
    }
  });

  it("keeps migrated studio CRUD routes and reused page components free of Next runtime imports", () => {
    const sources = [
      readSource("routes/w.$slug.studio.hiring-units.tsx"),
      readSource("routes/w.$slug.studio.job-descriptions.tsx"),
      readSource("routes/w.$slug.studio.interviewers.tsx"),
      readSource("routes/w.$slug.studio.departments.tsx"),
      readSource("routes/w.$slug.studio.forms.tsx"),
      readSource("components/features/studio/job-descriptions/job-description-form-dialog.tsx"),
    ];

    expect(sources.join("\n")).not.toMatch(
      /next\/(?:dynamic|navigation|headers|server|cache|link)/u,
    );
  });

  it("keeps hiring unit management under recruiting configuration navigation", () => {
    const sidebarSource = readSource("components/features/studio/studio-sidebar-slots.tsx");
    const workspaceLabelIndex = sidebarSource.indexOf('label: "招聘工作台"');
    const recruitingConfigLabelIndex = sidebarSource.indexOf('label: "招聘基础设置"');
    const libraryLabelIndex = sidebarSource.indexOf('label: "AI面试题库"');
    const workspaceGroup = sidebarSource.slice(
      sidebarSource.indexOf("const navGroups"),
      workspaceLabelIndex,
    );
    const recruitingConfigGroup = sidebarSource.slice(
      workspaceLabelIndex,
      recruitingConfigLabelIndex,
    );
    const libraryGroup = sidebarSource.slice(recruitingConfigLabelIndex, libraryLabelIndex);

    expect(workspaceGroup).not.toContain('path: "/studio/hiring-units"');
    expect(recruitingConfigGroup).toContain('path: "/studio/hiring-units"');
    expect(libraryGroup).not.toContain('path: "/studio/hiring-units"');
  });

  it("wraps hiring unit management in the standard studio page container", () => {
    const source = readSource("routes/w.$slug.studio.hiring-units.tsx");

    expect(source).toContain('className="mx-auto w-full max-w-[96rem] space-y-6"');
  });

  it("shows recruiting group hiring unit selections by item names inside the select only", () => {
    const membersSource = readSource("components/features/studio/members/members-groups.tsx");
    const hiringUnitSelectIndex = membersSource.indexOf('placeholder="负责用人组织"');
    const hiringUnitSelectSource = membersSource.slice(
      hiringUnitSelectIndex,
      hiringUnitSelectIndex + 500,
    );

    expect(hiringUnitSelectIndex).toBeGreaterThanOrEqual(0);
    expect(hiringUnitSelectSource).not.toContain('selectedDisplay="count"');
    expect(hiringUnitSelectSource).not.toMatch(/负责 \$\{count\} 个用人组织/u);
    expect(hiringUnitSelectSource).not.toContain("showBadges");
  });

  it("loads and saves recruiting group hiring unit scope through typed RPC", () => {
    const membersPageSource = readSource("components/features/studio/members/members-page.tsx");
    const saveStart = membersPageSource.indexOf("async function changeGroupHiringUnits");
    const saveEnd = membersPageSource.indexOf("async function changeWorkspaceRole", saveStart);
    const saveSource = membersPageSource.slice(saveStart, saveEnd);

    expect(membersPageSource).toContain('studio["hiring-units"].all.$get');
    expect(membersPageSource).toContain("rpcFetch<{ records:");
    expect(saveSource).toContain('["hiring-units"].$put');
    expect(saveSource).toContain("json: { hiringUnitIds }");
    expect(saveSource).toContain("await refetchGroups()");
  });

  it("filters the recruiting group member pool by name or email on the client", () => {
    const membersSource = readSource("routes/w.$slug.studio.members.tsx");
    const panelIndex = membersSource.indexOf("function RecruitingGroupsPanel");
    const panelSource = membersSource.slice(panelIndex, panelIndex + 7000);

    expect(panelSource).toContain("memberPoolSearch");
    expect(panelSource).toContain("filteredMemberPoolRows");
    expect(panelSource).toContain("row.name.toLowerCase()");
    expect(panelSource).toContain("row.email.toLowerCase()");
    expect(panelSource).toContain('placeholder="搜索成员名称或邮箱"');
    expect(panelSource).toContain("filteredMemberPoolRows.map");
  });

  it("lets workspace admins mark members as human interviewers", () => {
    const membersSource = readSource("components/features/studio/members/members-page.tsx");
    const pageIndex = membersSource.indexOf("function MembersManagementPage");
    const pageSource = membersSource.slice(pageIndex, pageIndex + 30_000);
    const controlSource = readSource(
      "components/features/studio/members/member-interviewer-control.tsx",
    );

    expect(controlSource).toContain('import { Switch } from "@/components/ui/switch";');
    expect(pageSource).toContain("interviewerColumn");
    expect(controlSource).toContain("changeMemberInterviewer");
    expect(controlSource).toContain('title: "真人面试官"');
    expect(controlSource).toContain("<Switch");
    expect(controlSource).toContain("studio.workspace.members[");
    expect(controlSource).toContain("].interviewer.$patch");
    expect(pageSource).toContain("isInterviewer");
  });

  it("sorts workspace member rows by newest creation time first", () => {
    const membersSource = readSource("routes/w.$slug.studio.members.tsx");
    const pageIndex = membersSource.indexOf("function MembersManagementPage");
    const pageSource = membersSource.slice(pageIndex, pageIndex + 25_000);

    expect(membersSource).toContain("function getMemberCreatedAtTime");
    expect(pageSource).toContain("getMemberCreatedAtTime(b.createdAt)");
    expect(pageSource).toContain("getMemberCreatedAtTime(a.createdAt)");
  });

  it("prompts for selectable hiring unit before importing resume pool items", () => {
    const resumePoolSource = readSource("routes/w.$slug.studio.resume-pool.tsx");
    const importDialogIndex = resumePoolSource.indexOf("function ImportResumePoolDialog");
    const importDialogSource = resumePoolSource.slice(importDialogIndex, importDialogIndex + 7000);
    const jobDescriptionIndex = importDialogSource.indexOf("<FieldLabel>关联岗位</FieldLabel>");
    const hiringUnitIndex = importDialogSource.indexOf('htmlFor="resume-pool-import-hiring-unit"');

    expect(resumePoolSource).toContain('["hiring-units"].selectable.$get');
    expect(importDialogSource).toContain("入库组织");
    expect(importDialogSource).toContain("推荐理由");
    expect(importDialogSource).toContain("recommendationText");
    expect(importDialogSource).not.toContain("入库组织（可选）");
    expect(jobDescriptionIndex).toBeGreaterThanOrEqual(0);
    expect(hiringUnitIndex).toBeGreaterThanOrEqual(0);
    expect(jobDescriptionIndex).toBeLessThan(hiringUnitIndex);
    expect(importDialogSource).toContain("hiringUnitInvalid");
    expect(resumePoolSource).toContain("hiringUnitId,");
  });
});
