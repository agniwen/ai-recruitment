import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const appRoot = path.resolve(import.meta.dirname, "..");
const serverOutput = path.join(appRoot, ".output", "server");
const bundleChecks = [
  { label: "S3 client", marker: "var S3Client = class" },
  { label: "Hono backend", marker: "function createServerApp()" },
];

async function findModuleWithMarker(directory: string, marker: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findModuleWithMarker(entryPath, marker)));
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name) !== ".mjs") {
      continue;
    }
    const source = await readFile(entryPath, "utf-8");
    if (source.includes(marker)) {
      matches.push(entryPath);
    }
  }

  return matches;
}

for (const { label, marker } of bundleChecks) {
  const matches = await findModuleWithMarker(serverOutput, marker);
  const [modulePath] = matches;
  if (!modulePath || matches.length !== 1) {
    throw new Error(
      `Expected exactly one server bundle containing the ${label}, found ${matches.length}.`,
    );
  }

  // Import the emitted code in plain Node, as the production container does.
  // Use an isolated environment: this checks module initialization only and
  // must not depend on a real database, Redis, or provider credentials in CI.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        globalThis.__dirname = ${JSON.stringify(serverOutput)};
        try {
          await import(${JSON.stringify(pathToFileURL(modulePath).href)});
          process.exit(0);
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      `,
    ],
    {
      env: {
        BETTER_AUTH_SECRET: "bundle-import-check-placeholder-secret",
        BETTER_AUTH_URL: "http://localhost:3000",
        DATABASE_URL: "postgres://bundle_check:bundle_check@127.0.0.1:1/bundle_check",
        FEISHU_APP_ID: "bundle-import-check",
        FEISHU_APP_ID2: "bundle-import-check",
        FEISHU_APP_SECRET: "bundle-import-check",
        FEISHU_APP_SECRET2: "bundle-import-check",
        GOOGLE_CLIENT_ID: "bundle-import-check",
        GOOGLE_CLIENT_SECRET: "bundle-import-check",
        NODE_ENV: "production",
      },
      stdio: "inherit",
      timeout: 30_000,
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(`Failed to import ${label} server bundle: ${modulePath}`, {
      cause: result.error ?? `Node exited with status ${result.status}, signal ${result.signal}`,
    });
  }
  console.log(`Verified server bundle import (${label}): ${path.relative(appRoot, modulePath)}`);
}
