import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(import.meta.dirname, "../../..");
const repoRoot = path.resolve(appRoot, "../..");

describe("Vite dependency optimization", () => {
  it("pre-bundles the Base UI package and all deep entry points", () => {
    const viteConfig = readFileSync(path.join(appRoot, "vite.config.ts"), "utf-8");

    expect(viteConfig).toContain('"@base-ui/react"');
    expect(viteConfig).toContain('"@base-ui/react/**"');
    expect(viteConfig).toContain('"cmdk"');
    expect(viteConfig).toContain('"semver"');
  });

  it("keeps the normal dev cache and reserves cache clearing for dev:fresh", () => {
    const packageJson = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.predev).toBeUndefined();
    expect(packageJson.scripts.dev).toBe("vite dev");
    expect(packageJson.scripts["dev:fresh"]).toContain("rm -rf node_modules/.vite");
    expect(packageJson.scripts["dev:fresh"]).toContain("vite dev --force");
  });

  it("uses the cached dev command from the default Make target", () => {
    const makefile = readFileSync(path.join(repoRoot, "Makefile"), "utf-8");
    const webDevRecipe = makefile.match(/web-dev:[^\n]*\n\t([^\n]+)/u)?.[1];

    expect(webDevRecipe).toBe("pnpm --filter @arc/ai-recruitment-copilot dev");
    expect(makefile).toContain("web-dev-fresh:");
  });

  it("keeps the Vite config hash stable between dev server restarts", () => {
    const viteConfig = readFileSync(path.join(appRoot, "vite.config.ts"), "utf-8");

    expect(viteConfig).toContain('command === "serve" ? DEV_BUILD_TIME');
  });

  it("recovers once when Vite reports a stale dynamic import", () => {
    const rootRoute = readFileSync(path.join(appRoot, "src/routes/__root.tsx"), "utf-8");

    expect(rootRoute).toContain('window.addEventListener("vite:preloadError"');
    expect(rootRoute).toContain("window.location.reload()");
  });
});
