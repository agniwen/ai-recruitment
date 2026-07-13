import { afterEach, describe, expect, it, vi } from "vitest";

const startFetch = vi.fn(() => Promise.resolve(new Response("start")));
const honoFetch = vi.fn(() => Promise.resolve(new Response("hono")));
const createOgImageResponse = vi.fn(
  () => new Response("og", { headers: { "Content-Type": "image/png" } }),
);
const createServerApp = vi.fn(() => ({
  fetch: honoFetch,
}));
const pingDatabase = vi.fn(() => Promise.resolve());
const getResumeParseQueueStats = vi.fn(() => Promise.resolve({ waiting: 0 }));
const isResumeParseQueueConfigured = vi.fn(() => false);

vi.mock("@tanstack/react-start/server-entry", () => ({
  createServerEntry: (entry: unknown) => entry,
  default: {
    fetch: startFetch,
  },
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/app", () => ({
  createServerApp,
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ pingDatabase }));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({
  getResumeParseQueueStats,
  isResumeParseQueueConfigured,
}));

vi.mock("./lib/server/og-image", () => ({
  createOgImageResponse,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("TanStack Start server entry", () => {
  it("serves the process health endpoint before loading API routers", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const request = new Request("https://example.test/api/health");

    const response = await entry.fetch(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(createServerApp).not.toHaveBeenCalled();
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("routes /api/rpc requests to the Hono app", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const request = new Request("https://example.test/api/rpc/health");

    const response = await entry.fetch(request);
    const text = await response.text();

    expect(text).toBe("hono");
    expect(honoFetch).toHaveBeenCalledWith(request);
    expect(createServerApp).toHaveBeenCalledTimes(1);
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("reports ready after required dependencies are available", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const response = await entry.fetch(new Request("https://example.test/api/ready"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(createServerApp).toHaveBeenCalledTimes(1);
    expect(pingDatabase).toHaveBeenCalledTimes(1);
    expect(getResumeParseQueueStats).not.toHaveBeenCalled();
  });

  it("checks the queue when resume parsing is configured", async () => {
    isResumeParseQueueConfigured.mockReturnValueOnce(true);
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const response = await entry.fetch(new Request("https://example.test/api/ready"));

    expect(response.status).toBe(200);
    expect(getResumeParseQueueStats).toHaveBeenCalledTimes(1);
  });

  it("does not expose readiness dependency errors", async () => {
    pingDatabase.mockRejectedValueOnce(new Error("secret database error"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const response = await entry.fetch(new Request("https://example.test/api/ready"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("serves the Open Graph image before loading API routers", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const response = await entry.fetch(new Request("https://example.test/og.png"));

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("og");
    expect(createOgImageResponse).toHaveBeenCalledTimes(1);
    expect(createServerApp).not.toHaveBeenCalled();
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("routes /api/app-version to TanStack Start", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const request = new Request("https://example.test/api/app-version");

    const response = await entry.fetch(request);

    expect(await response.text()).toBe("start");
    expect(startFetch).toHaveBeenCalledWith(request);
    expect(createServerApp).not.toHaveBeenCalled();
  });

  it("routes /api requests to the Hono app", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const request = new Request("https://example.test/api/resume/models");

    const response = await entry.fetch(request);
    const text = await response.text();

    expect(text).toBe("hono");
    expect(honoFetch).toHaveBeenCalledWith(request);
    expect(createServerApp).toHaveBeenCalledTimes(1);
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("routes non-api requests to the TanStack Start handler", async () => {
    const serverModule = await import("./server");
    const entry = serverModule.default;
    const request = new Request("https://example.test/login");

    const response = await entry.fetch(request);
    const text = await response.text();

    expect(text).toBe("start");
    expect(startFetch).toHaveBeenCalledWith(request);
  });
});
