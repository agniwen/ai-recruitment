import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { platformPreRegistrationsRouter } from "../route";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  listManagerOptions: vi.fn(),
  provision: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../dao", () => ({
  createPlatformPreRegistration: mocks.create,
  deletePlatformPreRegistration: mocks.delete,
  listPlatformPreRegistrationManagerOptions: mocks.listManagerOptions,
  queryPaginatedPlatformPreRegistrations: mocks.query,
  updatePlatformPreRegistration: mocks.update,
}));

vi.mock("../provisioning", () => ({
  provisionPreRegisteredUserByEmail: mocks.provision,
}));

const app = factory.createApp().route("/pre-registrations", platformPreRegistrationsRouter);

const input = {
  directManagerId: null,
  displayName: "张三",
  email: "member@example.com",
  recruitingGroupNames: ["燎原社"],
  recruitingRole: "hr",
  telegram: "@member",
};

describe("platform pre-registration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mocks.create).toHaveBeenCalledWith(input);
    expect(mocks.provision).toHaveBeenCalledWith("member@example.com");
  });

  it("rejects a manager cycle", async () => {
    mocks.update.mockResolvedValue("cycle");

    const response = await app.request("/pre-registrations/entry-1", {
      body: JSON.stringify({ ...input, directManagerId: "entry-2" }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "直属上级关系不能形成循环。" });
    expect(mocks.provision).not.toHaveBeenCalled();
  });
});
