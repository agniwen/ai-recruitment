import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build as buildWithEsbuild } from "esbuild";
import { createBuilder } from "vite";

// The Vite CLI leaves Rolldown worker threads alive after TanStack/Nitro
// prerendering on the current toolchain. The JS API resolves and exits cleanly.
try {
  // The JS API does not remove Nitro's previous output before prerendering.
  // Clear generated artifacts so /index.html always reflects this build.
  await rm(new URL("../.output/", import.meta.url), { force: true, recursive: true });
  const builder = await createBuilder({}, null);
  await builder.buildApp();
  await builder.runDevTools();
  await buildWithEsbuild({
    bundle: true,
    entryPoints: [fileURLToPath(new URL("migrate.ts", import.meta.url))],
    format: "esm",
    outfile: fileURLToPath(new URL("../.output/migrate.mjs", import.meta.url)),
    platform: "node",
    target: "node22",
  });
  // Server modules loaded for prerendering can leave connection pools or worker
  // handles alive. All build promises have resolved at this point, so terminate
  // explicitly instead of making CI wait for unrelated runtime handles.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
