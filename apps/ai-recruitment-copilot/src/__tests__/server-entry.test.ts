import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createStartHandler: vi.fn(),
  fetch: vi.fn(),
  honoFetch: vi.fn(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/app", () => ({
  createServerApp: () => ({ fetch: mocks.honoFetch }),
}));

vi.mock("../env/server", () => ({ applyServerEnv: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => {
  throw new ReferenceError("Cannot access '__vite_ssr_import_2__' before initialization");
});
vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: mocks.createStartHandler,
  defaultStreamHandler: vi.fn(),
}));

describe("server entry lazy Start initialization", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.fetch.mockImplementation(() => new Response("SSR"));
    mocks.createStartHandler.mockReturnValue(mocks.fetch);
  });

  it("serves health without evaluating the Start runtime", async () => {
    const { default: entry } = await import("../server");
    const response = await entry.fetch(new Request("http://localhost/api/health"));

    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.createStartHandler).not.toHaveBeenCalled();
  });

  it("passes production connection evidence to Hono without trusting direct-client headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "");
    mocks.honoFetch.mockImplementation(async (request: Request) => {
      const { requestEvidence } =
        await import("@arc/ai-recruitment-copilot-backend/server/routes/public/routes/interview-telemetry/utils");
      return Response.json(requestEvidence(request.headers));
    });
    const { default: entry } = await import("../server");
    const request = Object.assign(
      new Request("http://localhost/api/public/interview-telemetry", {
        headers: { "x-arc-dev-peer-ip": "203.0.113.99", "x-real-ip": "203.0.113.99" },
      }),
      { ip: "192.0.2.5" },
    );
    const response = await entry.fetch(request);
    expect(await response.json()).toMatchObject({ ip: "192.0.2.5", ipSource: "direct-connection" });
  });

  it("uses proxy headers when the production connection comes from a configured proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "10.20.0.0/24");
    mocks.honoFetch.mockImplementation(async (request: Request) => {
      const { requestEvidence } =
        await import("@arc/ai-recruitment-copilot-backend/server/routes/public/routes/interview-telemetry/utils");
      return Response.json(requestEvidence(request.headers));
    });
    const { default: entry } = await import("../server");
    const request = Object.assign(
      new Request("http://localhost/api/public/interview-telemetry", {
        headers: { "x-forwarded-for": "203.0.113.5" },
      }),
      { ip: "10.20.0.2" },
    );
    const response = await entry.fetch(request);
    expect(await response.json()).toMatchObject({
      ip: "203.0.113.5",
      ipSource: "trusted-proxy:x-forwarded-for",
    });
  });

  it("shares initialization across concurrent page and app-version requests", async () => {
    const { default: entry } = await import("../server");
    const page = new Request("http://localhost/login");
    const version = new Request("http://localhost/api/app-version");
    const responses = await Promise.all([entry.fetch(page), entry.fetch(version)]);

    expect(await Promise.all(responses.map((response) => response.text()))).toEqual(["SSR", "SSR"]);
    expect(mocks.createStartHandler).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(page);
    expect(mocks.fetch).toHaveBeenCalledWith(version);
  });
});
