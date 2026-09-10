import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeRoot = path.resolve(import.meta.dirname, "..");
function listRouteFiles(directory = routeRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__test__" || entry.name.includes(".test.")) {
      return [];
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listRouteFiles(fullPath);
    }
    return entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

describe("route module boundary", () => {
  it("keeps reusable page helpers outside the route tree", () => {
    const offenders = listRouteFiles().filter((file) => {
      const source = readFileSync(file, "utf-8");
      return !/create(?:File|Root)Route/u.test(source);
    });
    expect(offenders.map((file) => path.relative(routeRoot, file))).toEqual([]);
  });
});
