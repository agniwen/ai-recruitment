import { afterEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import type { listWorkspaceMemberHierarchy, updateWorkspaceMemberDirectManager } from "../dao";
import type * as WorkspaceDao from "../dao";

const mocks = vi.hoisted(() => ({
  listWorkspaceMemberHierarchy: vi.fn<typeof listWorkspaceMemberHierarchy>(),
  updateWorkspaceMemberDirectManager: vi.fn<typeof updateWorkspaceMemberDirectManager>(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../dao", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceDao>()),
  listWorkspaceMemberHierarchy: mocks.listWorkspaceMemberHierarchy,
  updateWorkspaceMemberDirectManager: mocks.updateWorkspaceMemberDirectManager,
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { workspaceRouter } from "../route";

const ORGANIZATION_ID = "direct_manager_route_org";
const ACTOR_USER_ID = "direct_manager_route_actor";

function makeApp() {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: ORGANIZATION_ID } as never);
      c.set("user", { id: ACTOR_USER_ID } as never);
      await next();
    })
    .route("/workspace", workspaceRouter);
}

describe("workspace direct-manager routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the workspace member hierarchy", async () => {
    mocks.listWorkspaceMemberHierarchy.mockResolvedValue([
      { directManagerUserId: "manager", userId: "report" },
    ]);

    const response = await makeApp().request("/workspace/members/hierarchy");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      records: [{ directManagerUserId: "manager", userId: "report" }],
    });
    expect(mocks.listWorkspaceMemberHierarchy).toHaveBeenCalledWith(ORGANIZATION_ID);
  });

  it("updates a member direct manager within the active workspace", async () => {
    mocks.updateWorkspaceMemberDirectManager.mockResolvedValue("updated");

    const response = await makeApp().request("/workspace/members/report/direct-manager", {
      body: JSON.stringify({ directManagerUserId: "manager" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.updateWorkspaceMemberDirectManager).toHaveBeenCalledWith({
      directManagerUserId: "manager",
      organizationId: ORGANIZATION_ID,
      userId: "report",
    });
  });

  it("rejects a direct-manager cycle", async () => {
    mocks.updateWorkspaceMemberDirectManager.mockResolvedValue("cycle");

    const response = await makeApp().request("/workspace/members/report/direct-manager", {
      body: JSON.stringify({ directManagerUserId: "manager" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "直属上级关系不能形成循环。" });
  });
});
