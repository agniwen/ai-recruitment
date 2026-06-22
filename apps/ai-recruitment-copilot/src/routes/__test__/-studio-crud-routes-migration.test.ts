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
    const workspaceLabelIndex = sidebarSource.indexOf('label: "工作台"');
    const recruitingConfigLabelIndex = sidebarSource.indexOf('label: "招聘配置"');
    const libraryLabelIndex = sidebarSource.indexOf('label: "题库"');
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

  it("shows recruiting group hiring unit selections by item names inside the select only", () => {
    const membersSource = readSource("routes/w.$slug.studio.members.tsx");
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
});
