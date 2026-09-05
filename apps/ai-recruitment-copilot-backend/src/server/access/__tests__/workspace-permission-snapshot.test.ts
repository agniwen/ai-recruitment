import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RecruitingGroupAccessModule from "../recruiting-group-access";
import { computeWorkspacePermissionSnapshot } from "../workspace-permission-snapshot";

const mocks = vi.hoisted(() => ({
  listGroupRoles: vi.fn(),
  selectDynamicRole: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mocks.selectDynamicRole,
        })),
      })),
    })),
  },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/access/recruiting-group-access", async () => {
  const actual = await vi.importActual<typeof RecruitingGroupAccessModule>(
    "../recruiting-group-access",
  );
  return {
    ...actual,
    listRecruitingGroupRoles: mocks.listGroupRoles,
  };
});

describe("computeWorkspacePermissionSnapshot", () => {
  it("reserves pre-registration access for administrators even if a custom role contains it", async () => {
    mocks.selectDynamicRole.mockResolvedValue([
      { permission: JSON.stringify({ page: ["resumes", "preRegistrations"] }) },
    ]);
    const custom = await computeWorkspacePermissionSnapshot({
      memberRole: "hr",
      organizationId: "org",
      userId: "u",
    });
    expect(custom.statements.page).toEqual(["resumes"]);
    for (const memberRole of ["admin", "owner"]) {
      const admin = await computeWorkspacePermissionSnapshot({
        memberRole,
        organizationId: "org",
        userId: "u",
      });
      expect(admin.statements.page).toContain("preRegistrations");
    }
  });
  beforeEach(() => {
    mocks.listGroupRoles.mockReset();
    mocks.selectDynamicRole.mockReset();
  });

  it("returns empty statements for noAccess", async () => {
    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "noAccess",
      organizationId: "org-a",
      userId: "user-a",
    });
    expect(snapshot).toEqual({ role: "noAccess", statements: {} });
    expect(mocks.listGroupRoles).not.toHaveBeenCalled();
  });

  it("returns built-in admin matrix without consulting recruiting groups", async () => {
    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "admin",
      organizationId: "org-a",
      userId: "user-a",
    });

    expect(snapshot.role).toBe("admin");
    expect(snapshot.statements.page).toEqual(
      expect.arrayContaining(["chat", "hiringUnits", "permissions", "resumes"]),
    );
    expect(snapshot.statements.interview).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
    expect(mocks.listGroupRoles).not.toHaveBeenCalled();
  });

  it("replaces member recruiting resources with group grants only", async () => {
    mocks.listGroupRoles.mockResolvedValue(["viewer"]);

    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "member",
      organizationId: "org-a",
      userId: "user-a",
    });

    expect(snapshot.statements.interview).toEqual(["read"]);
    expect(snapshot.statements.resumeLibrary).toEqual(["read"]);
    expect(snapshot.statements.page).toEqual(
      expect.arrayContaining(["chat", "hiringUnits", "members", "resumes"]),
    );
    expect(snapshot.statements.page).not.toEqual(expect.arrayContaining(["permissions"]));
    expect(snapshot.statements.offer).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
  });

  it("preserves fork-only organization resource rules outside recruiting group grants", async () => {
    mocks.listGroupRoles.mockResolvedValue(["hr"]);

    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "member",
      organizationId: "org-a",
      userId: "user-a",
    });

    expect(snapshot.statements.department).toEqual(["read"]);
    expect(snapshot.statements.hiringUnit).toEqual(["read"]);
  });

  it("gives member recruiting writers full catalog actions on gated resources", async () => {
    mocks.listGroupRoles.mockResolvedValue(["hr"]);

    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "member",
      organizationId: "org-a",
      userId: "user-a",
    });

    expect(snapshot.statements.resumePool).toEqual(
      expect.arrayContaining(["create", "read", "publish", "import", "delete"]),
    );
    expect(snapshot.statements.interview).toEqual(
      expect.arrayContaining(["create", "read", "update", "delete"]),
    );
  });

  it("clears recruiting resources when member has no group membership", async () => {
    mocks.listGroupRoles.mockResolvedValue([]);

    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "member",
      organizationId: "org-a",
      userId: "user-a",
    });

    expect(snapshot.statements.interview).toBeUndefined();
    expect(snapshot.statements.resumeLibrary).toBeUndefined();
    expect(snapshot.statements.department).toEqual(["read"]);
    expect(snapshot.statements.hiringUnit).toEqual(["read"]);
    expect(snapshot.statements.page).toEqual(expect.arrayContaining(["resumes"]));
  });

  it("loads dynamic role permissions from organizationRole", async () => {
    mocks.selectDynamicRole.mockResolvedValue([
      {
        permission: JSON.stringify({
          department: ["read", "update"],
          hiringUnit: ["read"],
          interview: ["read"],
          page: ["dashboard", "hiringUnits", "resumes"],
        }),
      },
    ]);

    const snapshot = await computeWorkspacePermissionSnapshot({
      memberRole: "custom-lead",
      organizationId: "org-a",
      userId: "user-a",
    });

    expect(snapshot.statements).toEqual({
      department: ["read", "update"],
      hiringUnit: ["read"],
      interview: ["read"],
      page: ["dashboard", "hiringUnits", "resumes"],
    });
    expect(mocks.listGroupRoles).not.toHaveBeenCalled();
  });
});
