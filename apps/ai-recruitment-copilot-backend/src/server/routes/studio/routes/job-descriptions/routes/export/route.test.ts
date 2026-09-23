import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobDescriptionExportRouter } from "./route";

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  query: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission:
    (resource: string, action: string): MiddlewareHandler =>
    async (c, next) => {
      if (!mocks.permissions.has(`${resource}:${action}`)) {
        return c.json({ message: "Forbidden" }, 403);
      }
      await next();
    },
}));
vi.mock("../../dao", () => ({ queryAllJobDescriptions: mocks.query }));

function app() {
  return new Hono<{ Variables: { activeOrg: { id: string }; user: { id: string } } }>()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "workspace" });
      c.set("user", { id: "odc" });
      await next();
    })
    .route("/export", jobDescriptionExportRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(["jd:read", "jd:export"]);
  mocks.query.mockResolvedValue([{ id: "job" }]);
});

describe("job export permissions", () => {
  it("allows dedicated job export without general data export and preserves actor scope and filters", async () => {
    const response = await app().request("/export?search=engineer&resumeSourceId=source");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records: [{ id: "job" }] });
    expect(mocks.query).toHaveBeenCalledWith(
      "workspace",
      expect.objectContaining({ actorUserId: "odc", resumeSourceId: "source", search: "engineer" }),
      expect.any(Object),
    );
  });

  it.each(["jd:read", "jd:export"])(
    "rejects exports without %s even with general export",
    async (permission) => {
      mocks.permissions.delete(permission);
      mocks.permissions.add("dataExport:export");
      const response = await app().request("/export");
      expect(response.status).toBe(403);
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );
});
