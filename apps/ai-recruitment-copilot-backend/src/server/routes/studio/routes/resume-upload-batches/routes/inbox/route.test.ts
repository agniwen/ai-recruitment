import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { uploadTaskInboxRouter } from "./route";

const mocks = vi.hoisted(() => ({ allowed: true, retry: vi.fn() }));
vi.mock("./utils", () => ({ listHistoricalResumeImports: vi.fn(), listUploadTaskInbox: vi.fn() }));
vi.mock("../../utils/retry-upload-item", () => ({ retryUploadItem: mocks.retry }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission:
    () =>
    async (c: { json: (data: unknown, status: number) => unknown }, next: () => Promise<void>) => {
      if (!mocks.allowed) {
        return c.json({ error: "Forbidden" }, 403);
      }
      await next();
    },
}));
const app = factory
  .createApp()
  .use(async (c, next) => {
    c.set("activeOrg", { id: "org-1" } as never);
    c.set("user", { id: "uploader" } as never);
    await next();
  })
  .route("/inbox", uploadTaskInboxRouter);

describe("upload inbox retry", () => {
  beforeEach(() => {
    mocks.allowed = true;
    vi.resetAllMocks();
  });
  it("restricts the retry to the current workspace and uploader", async () => {
    mocks.retry.mockResolvedValue({ status: "queued" });
    const response = await app.request("/inbox/item-1/retry", { method: "POST" });
    expect(response.status).toBe(200);
    expect(mocks.retry).toHaveBeenCalledWith({
      itemId: "item-1",
      organizationId: "org-1",
      requestedBy: "uploader",
      userId: "uploader",
    });
  });
  it.each([
    ["not_found", 404],
    ["not_failed", 409],
    ["queue_unavailable", 503],
  ])("maps %s to %i", async (status, code) => {
    mocks.retry.mockResolvedValue({ status });
    const response = await app.request("/inbox/item-1/retry", { method: "POST" });
    expect(response.status).toBe(code);
  });
  it("does not enqueue without process permission", async () => {
    mocks.allowed = false;
    const response = await app.request("/inbox/item-1/retry", { method: "POST" });
    expect(response.status).toBe(403);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("returns an actionable error when enqueueing fails", async () => {
    mocks.retry.mockRejectedValue(new Error("Redis down"));
    const response = await app.request("/inbox/item-1/retry", { method: "POST" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "重试入队失败，请稍后重试。" });
  });
});
