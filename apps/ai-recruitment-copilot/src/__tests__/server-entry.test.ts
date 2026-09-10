import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createStartHandler: vi.fn(),
  fetch: vi.fn(),
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
