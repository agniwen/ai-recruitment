import { afterEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import type {
  listWorkspaceMemberHierarchy,
  updateWorkspaceMemberDirectManager,
  updateWorkspaceMembersDirectManager,
} from "../dao";
import type * as MembersDao from "../dao";

const mocks = vi.hoisted(() => ({
  listWorkspaceMemberHierarchy: vi.fn<typeof listWorkspaceMemberHierarchy>(),
  updateWorkspaceMemberDirectManager: vi.fn<typeof updateWorkspaceMemberDirectManager>(),
  updateWorkspaceMembersDirectManager: vi.fn<typeof updateWorkspaceMembersDirectManager>(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../dao", async (importOriginal) => ({
  ...(await importOriginal<typeof MembersDao>()),
  listWorkspaceMemberHierarchy: mocks.listWorkspaceMemberHierarchy,
  updateWorkspaceMemberDirectManager: mocks.updateWorkspaceMemberDirectManager,
  updateWorkspaceMembersDirectManager: mocks.updateWorkspaceMembersDirectManager,
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() calls for correct hoisting.
import { membersRouter } from "../route";

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
    .route("/members", membersRouter);
}

describe("workspace direct-manager routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the workspace member hierarchy", async () => {
    mocks.listWorkspaceMemberHierarchy.mockResolvedValue([
      { directManagerUserId: "manager", userId: "report" },
    ]);

    const response = await makeApp().request("/members/hierarchy");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      records: [{ directManagerUserId: "manager", userId: "report" }],
    });
    expect(mocks.listWorkspaceMemberHierarchy).toHaveBeenCalledWith(ORGANIZATION_ID);
  });

  it("updates a member direct manager within the active workspace", async () => {
    mocks.updateWorkspaceMemberDirectManager.mockResolvedValue("updated");

    const response = await makeApp().request("/members/report/direct-manager", {
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

  it("updates several members to one direct manager atomically", async () => {
    mocks.updateWorkspaceMembersDirectManager.mockResolvedValue("updated");

    const response = await makeApp().request("/members/direct-manager/batch", {
      body: JSON.stringify({
        directManagerUserId: "manager",
        userIds: ["report-a", "report-b"],
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.updateWorkspaceMembersDirectManager).toHaveBeenCalledWith({
      directManagerUserId: "manager",
      organizationId: ORGANIZATION_ID,
      userIds: ["report-a", "report-b"],
    });
  });

  it.each([
    ["self", 400, "直属上级不能是已选成员。"],
    ["cycle", 409, "直属上级关系不能形成循环。"],
  ] as const)("rejects a batch direct-manager %s result", async (result, status, error) => {
    mocks.updateWorkspaceMembersDirectManager.mockResolvedValue(result);

    const response = await makeApp().request("/members/direct-manager/batch", {
      body: JSON.stringify({ directManagerUserId: "manager", userIds: ["report"] }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it.each([
    ["self", 400, "成员不能成为自己的直属上级。"],
    ["cycle", 409, "直属上级关系不能形成循环。"],
  ] as const)("maps the %s result to an API error", async (result, status, error) => {
    mocks.updateWorkspaceMemberDirectManager.mockResolvedValue(result);

    const response = await makeApp().request("/members/report/direct-manager", {
      body: JSON.stringify({ directManagerUserId: "manager" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
