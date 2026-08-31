import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "../..");

function readSource(relativePath: string) {
  return readFileSync(path.join(srcRoot, relativePath), "utf-8");
}

describe("TanStack Start studio settings and detail route migration", () => {
  const routes = [
    "/w/$slug/studio/interview-questions",
    "/w/$slug/studio/global-config",
    "/w/$slug/studio/permissions",
    "/w/$slug/studio/members",
    "/w/$slug/studio/me",
    "/w/$slug/studio/mail-ingest-accounts",
    "/w/$slug/studio/interviews/$roundId",
  ];

  it("registers migrated studio settings and detail routes in the generated route tree", () => {
    const routeTree = readSource("routeTree.gen.ts");

    for (const route of routes) {
      expect(routeTree).toContain(`'${route}'`);
    }
  });

  it("keeps migrated route files and reused components free of Next runtime imports", () => {
    const sources = [
      readSource("routes/w.$slug.studio.interview-questions.tsx"),
      readSource("routes/w.$slug.studio.global-config.tsx"),
      readSource("routes/w.$slug.studio.permissions.tsx"),
      readSource("routes/w.$slug.studio.members.tsx"),
      readSource("routes/w.$slug.studio.me.tsx"),
      readSource("routes/w.$slug.studio.mail-ingest-accounts.tsx"),
      readSource("routes/w.$slug.studio.interviews.$roundId.tsx"),
      readSource("components/features/studio/global-config/global-config-form.tsx"),
      readSource("components/features/studio/members/workspace-permissions-section.tsx"),
    ];

    expect(sources.join("\n")).not.toMatch(
      /next\/(?:dynamic|navigation|headers|server|cache|link)/u,
    );
  });

  it("exposes workspace permission management as a system configuration page", () => {
    const sidebar = readSource("components/features/studio/studio-sidebar-slots.tsx");
    const permissionsRoute = readSource("routes/w.$slug.studio.permissions.tsx");
    const globalConfigForm = readSource(
      "components/features/studio/global-config/global-config-form.tsx",
    );

    expect(sidebar).toContain('path: "/studio/permissions"');
    expect(sidebar).toContain('title: "角色与权限"');
    expect(sidebar).toContain('action: "permissions"');
    expect(sidebar).toContain('resource: "page"');
    expect(permissionsRoute).toContain("<WorkspacePermissionsSection");
    expect(permissionsRoute).toContain("headerRender");
    expect(globalConfigForm).not.toContain("<WorkspacePermissionsSection />");
  });

  it("keeps context settings as a bare form with debounced auto-save", () => {
    const source = readSource("components/features/studio/global-config/global-config-form.tsx");

    expect(source).toContain("useDebouncedCallback");
    expect(source).toContain("AUTOSAVE_DEBOUNCE_MS");
    expect(source).toContain('toast.success("自动保存成功")');
    expect(source).not.toContain("actionRender={");
    expect(source).not.toContain("保存配置");
    expect(source).toContain('<FieldGroup className="gap-5">');
    expect(source).not.toContain("@/components/ui/card");
    expect(source).not.toContain("<Card");
    expect(source).not.toContain("<CardHeader");
    expect(source).not.toContain("<CardContent");
    expect(source).not.toContain("Agent 全局指令");
    expect(source).not.toContain("配置面试话术和公司背景");
  });

  it("keeps context settings as the last item in the system configuration group", () => {
    const sidebar = readSource("components/features/studio/studio-sidebar-slots.tsx");
    const systemGroupStart = sidebar.indexOf('label: "系统设置"');
    const systemGroupSource = sidebar.slice(
      sidebar.lastIndexOf("items:", systemGroupStart),
      systemGroupStart,
    );
    const permissionIndex = systemGroupSource.indexOf('title: "角色与权限"');
    const settingsIndex = systemGroupSource.indexOf('title: "公司信息与话术"');

    expect(permissionIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThan(permissionIndex);
  });

  it("hides studio sidebar groups after permissions remove all menu items", () => {
    const sidebar = readSource("components/features/studio/studio-sidebar-slots.tsx");
    const sidebarGroup = readSource("components/ui/sidebar.tsx");

    expect(sidebar).toContain('className="hidden has-[[data-sidebar=menu-item]]:flex"');
    expect(sidebarGroup).not.toContain("has-[[data-sidebar=menu-item]]:flex");
  });

  it("guards direct studio page access with page permissions", () => {
    const studioRoute = readSource("routes/w.$slug.studio.tsx");
    const authSession = readSource("lib/start/auth-session.ts");
    const authSessionServer = readSource("lib/start/auth-session.server.ts");
    const pageAccess = readSource("lib/start/studio/page-access.server.ts");
    const permissionSnapshot = readSource(
      "../../ai-recruitment-copilot-backend/src/server/access/workspace-permission-snapshot.ts",
    );

    expect(studioRoute).toContain("parentMatchPromise");
    expect(studioRoute).toContain("hasPermissionInStatements");
    expect(studioRoute).toContain("findFirstAllowedStudioPath");
    expect(studioRoute).toContain("getFirstAllowedStudioPagePath");
    expect(studioRoute).toContain("STUDIO_PAGE_PATHS");
    expect(studioRoute).toContain(
      'hasPermissionInStatements(state.permissions, "page", requestedPage.action)',
    );
    expect(studioRoute).toMatch(/state\.status !== "ready"[\s\S]+throw notFound\(\);/u);
    expect(authSession).toContain("getFirstAllowedStudioPagePath");
    expect(authSessionServer).toContain("computeWorkspacePermissionSnapshot");
    expect(pageAccess).toContain("resolveAuthorizedStudioPageAccessFromRequest");
    expect(pageAccess).toContain('hasPermissionInStatements(access.permissions, "page", action)');
    expect(permissionSnapshot).toContain("organizationRole.permission");
  });

  it("guards Studio server data loaders and client-only lists with matching permissions", () => {
    const pageAccess = readSource("lib/start/studio/page-access.server.ts");
    const serverDataPages = [
      ["dashboard", "dashboard"],
      ["forms", "forms"],
      ["global-config", "globalConfig"],
      ["hiring-units", "hiringUnits"],
      ["interview-questions", "interviewQuestions"],
      ["interviewers", "interviewers"],
      ["job-descriptions", "jobDescriptions"],
    ] as const;

    expect(pageAccess).toContain("resolveWorkspaceAccessFromRequest");
    expect(pageAccess).toContain('return { status: "not_found" }');

    for (const [file, action] of serverDataPages) {
      const source = readSource(`lib/start/studio/${file}.functions.ts`);
      const guardIndex = source.indexOf(`"${action}"`);
      const prefetchIndex = source.search(
        /await loadStudio[A-Za-z]+(?:Data|HydrationState|Initial|Metrics)\(/u,
      );

      expect(source).toContain("resolveAuthorizedStudioPageAccessFromRequest");
      expect(guardIndex).toBeGreaterThanOrEqual(0);
      expect(prefetchIndex).toBeGreaterThan(guardIndex);
    }

    const studioRoute = readSource("routes/w.$slug.studio.tsx");
    const clientListPages = [
      "components/features/studio/departments/department-management-page.tsx",
      "components/features/studio/interviews/interview-management-page.tsx",
    ] as const;
    for (const file of clientListPages) {
      const source = readSource(file);
      expect(source).not.toContain(".functions");
      expect(source).toContain("useDataGridState");
      expect(source).toContain("rpcFetch");
    }
    expect(studioRoute).toContain(
      'hasPermissionInStatements(state.permissions, "page", requestedPage.action)',
    );

    const resumesRoute = readSource("routes/w.$slug.studio.resumes.tsx");
    const resumesState = readSource("lib/start/studio/resumes-state.server.ts");
    const resumesAccess = readSource("lib/start/studio/resumes-access.ts");
    const accessIndex = resumesState.indexOf("canReadStudioResumes(access)");

    expect(resumesRoute).toContain("loadStudioResumesState");
    expect(resumesAccess).toContain(
      'hasPermissionInStatements(access.permissions, "page", "resumes")',
    );
    expect(resumesAccess).toContain(
      'hasPermissionInStatements(access.permissions, "resumeLibrary", "read")',
    );
    expect(accessIndex).toBeGreaterThanOrEqual(0);
    expect(resumesState).toContain('return { status: "ready" }');
    expect(resumesState).not.toContain("loadStudioResumesData");
  });

  it("keeps workspace permission role actions compact in the role column", () => {
    const source = readSource(
      "components/features/studio/members/workspace-permissions-section.tsx",
    );
    const routeSource = readSource("routes/w.$slug.studio.permissions.tsx");
    const pageHeaderSource = readSource("components/features/studio/page-header.tsx");

    expect(source).toContain("IconPencil");
    expect(source).toContain("IconCopy");
    expect(source).toContain("IconTrash");
    expect(source).toContain("RoleFormDialog");
    expect(source).toContain("AlertDialog");
    expect(source).toContain("nextPermission = togglePermissionAction");
    expect(source).toContain("permissionHeaderGroups");
    expect(source).toContain("rowSpan={2}");
    expect(source).toContain("colSpan={group.items.length}");
    expect(source).toContain("新建角色");
    expect(source).toContain('<section className="flex flex-col gap-4">');
    expect(source).not.toContain("角色权限表");
    expect(source).not.toContain("每一行是工作区角色");
    expect(source).toContain("headerRender?.({ actionRender: createRoleAction })");
    expect(routeSource).toContain("headerRender={({ actionRender }) =>");
    expect(routeSource).toContain("actionRender={actionRender}");
    expect(pageHeaderSource).toContain("actionRender?: ReactNode;");
    expect(pageHeaderSource).toContain("{actionRender ? <div");
    expect(source).toContain("name: input.name");
    expect(source).toContain("角色标识创建后不可更改");
    expect(source).toContain('canEditDynamicRoleIdentifier(state?.mode ?? "create")');
    expect(source).not.toContain("data.roleName");
    expect(source).not.toContain("@/components/ui/card");
    expect(source).not.toContain("<Card");
    expect(source).not.toContain("<CardHeader");
    expect(source).not.toContain("<CardContent");
    expect(source).not.toContain("IconDeviceFloppy");
    expect(source).not.toContain('title="保存权限"');
    expect(source).not.toContain("showStatusText");
    expect(source).not.toContain("内置允许");
    expect(source).not.toContain("未授权");
    expect(source).not.toContain("sticky right-0");
    expect(source).not.toContain(">操作<");
  });

  it("keeps the mail ingest account table aligned with shared table conventions", () => {
    const source = readSource("routes/w.$slug.studio.mail-ingest-accounts.tsx");
    const memberCellSource = readSource("components/data-grid/cells/member-cell.tsx");

    expect(source).toContain(
      'import { MemberCell } from "@/components/data-grid/cells/member-cell"',
    );
    expect(source).toContain("<MemberCell");
    expect(source).toContain("useDataGridState<ManagedMailIngestRow");
    expect(source).toContain("<DataGrid<ManagedMailIngestRow>");
    expect(source).toContain('type: "search"');
    expect(source).toContain('columnPinning={{ end: ["actions"] }}');
    expect(source).not.toContain("<Table>");
    expect(source).not.toContain("function getInitials");
    expect(source).not.toContain("IconPencil");
    expect(source).not.toContain("IconPlus");
    expect(memberCellSource).toContain('avatarSize = "sm"');
  });

  it("splits mail ingest account role and status into separate columns", () => {
    const source = readSource("routes/w.$slug.studio.mail-ingest-accounts.tsx");
    const roleColumnSource = source.slice(
      source.indexOf('key: "role"'),
      source.indexOf('key: "status"'),
    );
    const statusColumnSource = source.slice(
      source.indexOf('key: "status"'),
      source.indexOf('key: "imapHost"'),
    );

    expect(source).toContain("authClient.organization.listRoles");
    expect(source).toContain("buildWorkspaceRoleOptions");
    expect(roleColumnSource).toContain('title: "角色"');
    expect(source).toContain("roleLabelByValue.get(row.user.role) ?? row.user.role");
    expect(statusColumnSource).toContain('title: "状态"');
    expect(source).toContain('let statusLabel = "未配置";');
    expect(source).toContain('statusLabel = "启用";');
    expect(source).toContain('statusLabel = "停用";');
    expect(statusColumnSource).not.toContain("roleLabelByValue");
  });
});
