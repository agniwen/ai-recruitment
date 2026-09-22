import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { odcResponsibilitiesRouter } from "./route";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  import: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./dao", () => ({
  importResponsibilities: mocks.import,
  loadResponsibilityCatalog: mocks.catalog,
  previewResponsibilityRows: mocks.preview,
  saveResponsibility: mocks.save,
}));

function request(role: string, path: string, method = "GET", body?: unknown) {
  const app = new Hono<{ Variables: { activeOrg: { id: string }; member: { role: string } } }>()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org" });
      c.set("member", { role });
      await next();
    })
    .route("/", odcResponsibilitiesRouter);
  return app.request(path, {
    body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
    method,
  });
}

beforeEach(() => vi.clearAllMocks());
describe("ODC responsibility administration", () => {
  it.each([
    ["/", "GET"],
    ["/", "PUT"],
    ["/preview", "POST"],
    ["/import", "POST"],
  ])("rejects non-admin %s %s before accessing data", async (path, method) => {
    const response = await request("odc", path, method);
    expect(response.status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.import).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("allows %s to load only the active workspace", async (role) => {
    mocks.catalog.mockResolvedValue({ members: [] });
    const response = await request(role, "/");
    expect(response.status).toBe(200);
    expect(mocks.catalog).toHaveBeenCalledWith("org");
  });
  it("rejects invalid imports without writing", async () => {
    const response = await request("admin", "/import", "POST", { rows: [] });
    expect(response.status).toBe(400);
    expect(mocks.import).not.toHaveBeenCalled();
  });
  it("reports changed or invalid matches at commit", async () => {
    mocks.import.mockResolvedValue({ ok: false, preview: [] });
    const rows = [{ center: "中心", departments: "部门", email: "a@example.com", name: "张三" }];
    const response = await request("admin", "/import", "POST", { rows });
    expect(response.status).toBe(409);
    expect(mocks.import).toHaveBeenCalledWith("org", rows);
  });
});
