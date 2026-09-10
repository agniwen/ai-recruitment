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
    const source = readSource(
      "components/features/studio/hiring-units/hiring-unit-management-page.tsx",
    );

    expect(source).toContain('className="mx-auto w-full max-w-[96rem] space-y-6"');
  });

  it("shows recruiting group resume source selections by item names inside the select only", () => {
    const membersSource = readSource("components/features/studio/members/members-groups.tsx");
    const resumeSourceSelectIndex = membersSource.indexOf('placeholder="负责部门/中心（来源）"');
    const resumeSourceSelectSource = membersSource.slice(
      resumeSourceSelectIndex,
      resumeSourceSelectIndex + 500,
    );

    expect(resumeSourceSelectIndex).toBeGreaterThanOrEqual(0);
    expect(resumeSourceSelectSource).not.toContain('selectedDisplay="count"');
    expect(resumeSourceSelectSource).not.toMatch(/负责 \$\{count\} 个部门\/中心（来源）/u);
    expect(resumeSourceSelectSource).not.toContain("showBadges");
  });

  it("loads and saves recruiting group resume source scope through typed RPC", () => {
    const membersPageSource = readSource("components/features/studio/members/members-page.tsx");
    const saveStart = membersPageSource.indexOf("async function changeGroupResumeSources");
    const saveEnd = membersPageSource.indexOf("async function changeWorkspaceRole", saveStart);
    const saveSource = membersPageSource.slice(saveStart, saveEnd);

    expect(membersPageSource).toContain('studio["resume-sources"].$get');
    expect(membersPageSource).toContain("rpcFetch<{ records:");
    expect(saveSource).toContain('["resume-sources"].$put');
    expect(saveSource).toContain("json: { resumeSourceIds }");
    expect(saveSource).toContain("await refetchGroups()");
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

  it("prompts for selectable hiring unit before importing resume pool items", () => {
    const resumePoolSource = readSource(
      "components/features/studio/resume-pool/resume-pool-dialogs.tsx",
    );
    const importDialogIndex = resumePoolSource.indexOf("function ImportResumePoolDialog");
    const importDialogSource = resumePoolSource.slice(importDialogIndex);
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
