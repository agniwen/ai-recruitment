import { once } from "node:events";
import { promisify } from "node:util";
import { setImmediate } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeRequestHandler } from "./request-handler";
import { runWithRequestPeerIp } from "../lib/server/request-ip-context";
import { requestEvidence } from "../server/routes/public/routes/interview-telemetry/utils";

afterEach(() => vi.unstubAllEnvs());

describe("transport IP context", () => {
  it.each([false, true])("captures a real TCP connection with trust proxy=%s", async (trusted) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", trusted ? "127.0.0.1" : "");
    const app = new Hono().get("/", async (c) => {
      await setImmediate();
      return c.json(requestEvidence(c.req.raw.headers), 200);
    });
    const server = serve({
      fetch: createNodeRequestHandler(app.fetch),
      hostname: "127.0.0.1",
      port: 0,
    });
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP listener");
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        headers: { "x-real-ip": "203.0.113.5" },
      });
      expect(await response.json()).toMatchObject({
        ip: trusted ? "203.0.113.5" : "127.0.0.1",
        ipSource: trusted ? "trusted-proxy:x-real-ip" : "direct-connection",
      });
    } finally {
      const closed = promisify(server.close.bind(server))();
      if ("closeAllConnections" in server) {
        server.closeAllConnections();
      }
      await closed;
    }
  });

  it("isolates concurrent requests and clears the context afterwards", async () => {
    vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", "");
    const addresses = ["192.0.2.1", "2001:db8::2"];
    const results = await Promise.all(
      addresses.map((ip) =>
        runWithRequestPeerIp(ip, async () => {
          await setImmediate();
          return requestEvidence(new Headers()).ip;
        }),
      ),
    );
    expect(results).toEqual(addresses);
    expect(requestEvidence(new Headers()).ip).toBeNull();
  });
});
