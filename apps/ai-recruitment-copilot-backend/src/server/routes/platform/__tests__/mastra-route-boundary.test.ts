import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const platformRouteSource = readFileSync(new URL("../route.ts", import.meta.url), "utf-8");

describe("platform Mastra route boundary", () => {
  it("removes the debugging API while retaining admin protection and business routes", () => {
    expect(platformRouteSource).not.toContain("platformMastraRouter");
    expect(existsSync(new URL("../routes/mastra/route.ts", import.meta.url))).toBe(false);
    expect(platformRouteSource).toContain(".use(adminMiddleware)");
    expect(platformRouteSource).toContain('"/livekit"');
    expect(platformRouteSource).toContain('"/queues"');
  });

  it("retains the production Mastra entrypoint", () => {
    expect(existsSync(new URL("../../../agents/mastra/index.ts", import.meta.url))).toBe(true);
  });
});
