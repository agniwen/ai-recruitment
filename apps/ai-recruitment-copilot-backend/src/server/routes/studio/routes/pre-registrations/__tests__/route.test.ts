import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { studioPreRegistrationsRouter } from "../route";

const mocks = vi.hoisted(() => ({
  canAssign: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  listManagerOptions: vi.fn(),
  provision: vi.fn(),
  query: vi.fn(),
  role: "admin",
  update: vi.fn(),
}));

vi.mock("../dao", () => ({
  createStudioPreRegistration: mocks.create,
  deleteStudioPreRegistration: mocks.delete,
  listStudioPreRegistrationManagerOptions: mocks.listManagerOptions,
  queryPaginatedStudioPreRegistrations: mocks.query,
  updateStudioPreRegistration: mocks.update,
}));

vi.mock("../provisioning", () => ({
  provisionPreRegisteredUserByEmail: mocks.provision,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-roles", () => ({
  canAssignWorkspaceRole: mocks.canAssign,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => factory.createMiddleware(async (_c, next) => await next()),
}));
const app = factory
  .createApp()
  .use("*", async (c, next) => {
    c.set("user", {
      banExpires: null,
      banReason: null,
      banned: false,
      createdAt: new Date(),
      email: "admin@example.com",
      emailVerified: true,
      id: "u",
      image: null,
      name: "Admin",
      role: "user",
      updatedAt: new Date(),
    });
    c.set("activeOrg", {
      createdAt: new Date(),
      id: "org-alpha",
      logo: null,
      metadata: null,
      name: "Alpha",
      slug: "alpha",
    });
    c.set("member", {
      createdAt: new Date(),
      id: "m",
      inviteLinkId: null,
      isInterviewer: false,
      organizationId: "org-alpha",
      role: mocks.role,
      userId: "u",
    });
    return await next();
  })
  .route("/pre-registrations", studioPreRegistrationsRouter);

const input = {
  directManagerEmail: null,
  displayName: "张三",
  email: "member@example.com",
  recruitingGroupNames: ["燎原社"],
  recruitingRole: "hr",
  telegram: "@member",
  workspaceRole: "custom-hr",
};

describe("studio pre-registration routes", () => {
  it.each(["member", "custom-hr", "noAccess"])("denies all endpoints to %s", async (role) => {
    mocks.role = role;
    for (const path of ["", "/manager-options", "/role-options"]) {
      const response = await app.request(`/pre-registrations${path}`);
      expect(response.status).toBe(403);
    }
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await app.request(`/pre-registrations${method === "POST" ? "" : "/entry"}`, {
        method,
      });
      expect(response.status).toBe(403);
    }
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects a role outside the caller's assignment permissions", async () => {
    mocks.canAssign.mockResolvedValue(false);
    const response = await app.request("/pre-registrations", {
      body: JSON.stringify({ ...input, workspaceRole: "owner" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(403);
    expect(mocks.canAssign).toHaveBeenCalledWith({
      invokerRole: "admin",
      organizationId: "org-alpha",
      targetRole: "owner",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("passes workspace scope to reads, manager options, updates and deletes", async () => {
    mocks.query.mockResolvedValue({ records: [] });
    mocks.listManagerOptions.mockResolvedValue([]);
    await app.request("/pre-registrations");
    await app.request("/pre-registrations/manager-options");
    expect(mocks.query).toHaveBeenCalledWith("alpha", expect.any(Object));
    expect(mocks.listManagerOptions).toHaveBeenCalledWith("alpha");
    mocks.update.mockResolvedValue("not_found");
    const response = await app.request("/pre-registrations/other-workspace-id", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    expect(response.status).toBe(404);
    expect(mocks.update).toHaveBeenCalledWith("alpha", "other-workspace-id", input);
    mocks.delete.mockResolvedValue(false);
    const deleted = await app.request("/pre-registrations/other-workspace-id", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(404);
    expect(mocks.delete).toHaveBeenCalledWith("alpha", "other-workspace-id");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = "admin";
    mocks.canAssign.mockResolvedValue(true);
  });

  it("creates a pre-entry and immediately provisions an already registered user", async () => {
    mocks.create.mockResolvedValue({ ...input, id: "entry-1", workspaceSlug: "work" });
    mocks.provision.mockResolvedValue("unmatched");

    const response = await app.request("/pre-registrations", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("alpha", input);
    expect(mocks.provision).toHaveBeenCalledWith("member@example.com", "alpha");
  });

  it("rejects a manager cycle", async () => {
    mocks.update.mockResolvedValue("cycle");

    const response = await app.request("/pre-registrations/entry-1", {
      body: JSON.stringify({ ...input, directManagerEmail: "manager@example.com" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "直属上级关系不能形成循环。" });
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("rejects using the same email as the direct manager", async () => {
    const response = await app.request("/pre-registrations", {
      body: JSON.stringify({ ...input, directManagerEmail: "MEMBER@example.com" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
