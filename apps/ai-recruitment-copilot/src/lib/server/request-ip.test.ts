import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDevRequestIp, getWebRequestPeerIp } from "./request-ip";

afterEach(() => vi.unstubAllEnvs());

describe("development request IP transport", () => {
  it("uses the original Vite peer ahead of the worker connection", () => {
    vi.stubEnv("NODE_ENV", "development");
    const request = Object.assign(
      new Request("http://localhost", {
        headers: { "x-arc-dev-peer-ip": "192.0.2.5" },
      }),
      { ip: "127.0.0.1" },
    );
    expect(getWebRequestPeerIp(request)).toBe("192.0.2.5");
  });
  it("uses the production runtime peer and ignores forged development headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = Object.assign(
      new Request("http://localhost", {
        headers: { "x-arc-dev-peer-ip": "203.0.113.99" },
      }),
      { ip: "192.0.2.5" },
    );
    expect(getWebRequestPeerIp(request)).toBe("192.0.2.5");
    expect(getWebRequestPeerIp(new Request("http://localhost"))).toBeUndefined();
  });
  it("replaces a client-supplied address with the actual TCP peer", async () => {
    const server = createServer((request, response) => {
      captureDevRequestIp(request, response, () => {
        response.end(request.headers["x-arc-dev-peer-ip"]);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP test server");
      }
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/public/interview-telemetry`,
        {
          headers: { "x-arc-dev-peer-ip": "203.0.113.99" },
        },
      );
      expect(await response.text()).toBe("127.0.0.1");
    } finally {
      const closed = promisify(server.close.bind(server))();
      server.closeAllConnections();
      await closed;
    }
  });
});
