import { describe, expect, it, vi } from "vitest";
import { factory } from "../../../../factory";
import { createInterviewLogsRouter } from "./route";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));
describe("platform interview log access", () => {
  it("denies unauthenticated and non-platform-admin users before querying", async () => {
    const list = vi.fn();
    const detail = vi.fn();
    for (const role of [null, "user", "hr", "owner"]) {
      const app = factory
        .createApp()
        .use(async (c, next) => {
          if (role) {
            c.set("user", { id: "user", role } as typeof c.var.user);
          }
          await next();
        })
        .route("/logs", createInterviewLogsRouter({ detail, list }));
      for (const path of ["/logs", "/logs/meeting", "/logs/meeting/entry-credentials"]) {
        const response = await app.request(path);
        expect(response.status).toBe(role ? 403 : 401);
      }
    }
    expect(list).not.toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });
  it("allows admins and validates filters without caching sensitive responses", async () => {
    const list = vi.fn().mockResolvedValue({ records: [], total: 0 });
    const detail = vi.fn().mockResolvedValue({ records: [], total: 0 });
    const app = factory
      .createApp()
      .use(async (c, next) => {
        c.set("user", { id: "admin", role: "admin" } as typeof c.var.user);
        await next();
      })
      .route("/logs", createInterviewLogsRouter({ detail, list }));
    const response = await app.request("/logs/meeting?source=livekit");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(detail).toHaveBeenCalledWith("meeting", expect.objectContaining({ source: "livekit" }));
    const invalid = await app.request("/logs?pageSize=10000");
    expect(invalid.status).toBe(400);
    const keyView = await app.request("/logs/meeting?view=key");
    expect(keyView.status).toBe(200);
    expect(detail).toHaveBeenLastCalledWith("meeting", expect.objectContaining({ view: "key" }));
    const invalidView = await app.request("/logs/meeting?view=unknown");
    expect(invalidView.status).toBe(400);
    const urlIp = await app.request("/logs/meeting?ip=203.0.113.7");
    expect(urlIp.status).toBe(400);
    const postIp = await app.request("/logs/meeting/search", {
      body: JSON.stringify({ ip: "203.0.113.7" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(postIp.status).toBe(200);
    expect(detail).toHaveBeenLastCalledWith(
      "meeting",
      expect.objectContaining({ ip: "203.0.113.7" }),
    );
  });
});
