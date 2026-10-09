import { describe, expect, it, vi } from "vitest";
import { factory } from "../../../../../../factory";
import { createInterviewMediaRouter } from "./route";
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

function setup(role?: string) {
  const dependencies = { content: vi.fn(), detail: vi.fn(), list: vi.fn(), remove: vi.fn() };
  const app = factory
    .createApp()
    .use(async (c, next) => {
      if (role) {
        c.set("user", { id: "actor-admin", role } as typeof c.var.user);
      }
      await next();
    })
    .route("/media", createInterviewMediaRouter(dependencies));
  return { app, dependencies };
}
describe("private interview media access", () => {
  it("protects archive, metadata, binary and delete endpoints with platform admin authorization", async () => {
    for (const role of [undefined, "user", "owner", "hr"]) {
      const { app, dependencies } = setup(role);
      for (const [path, method] of [
        ["/media", "GET"],
        ["/media/meetings/meeting", "GET"],
        ["/media/assets/id/content", "GET"],
        ["/media/assets/id", "DELETE"],
      ]) {
        const result = await app.request(path, { method });
        expect(result.status).toBe(role ? 403 : 401);
      }
      for (const call of Object.values(dependencies)) {
        expect(call).not.toHaveBeenCalled();
      }
    }
  });
  it("serves admin-only media without caching and attributes access to the authenticated actor", async () => {
    const { app, dependencies } = setup("admin");
    dependencies.content.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
    });
    const result = await app.request("/media/assets/id/content");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("content-type")).toBe("audio/wav");
    expect(dependencies.content).toHaveBeenCalledWith("id", "actor-admin");
    dependencies.content.mockResolvedValue(null);
    const deleted = await app.request("/media/assets/deleted/content");
    expect(deleted.status).toBe(404);
  });
  it("reports pending and failed cleanup without leaking storage details", async () => {
    const { app, dependencies } = setup("admin");
    dependencies.remove.mockResolvedValue("pending");
    const pending = await app.request("/media/assets/id", { method: "DELETE" });
    expect(pending.status).toBe(409);
    dependencies.remove.mockRejectedValue(new Error("secret key"));
    const failed = await app.request("/media/assets/id", { method: "DELETE" });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret key");
    dependencies.remove.mockResolvedValue("deleted");
    const deleted = await app.request("/media/assets/id", { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });
});
