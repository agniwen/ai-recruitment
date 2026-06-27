import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = process.cwd();
const sourceRoot = join(appRoot, "src");
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const testPathMarkers = [
  `${join("src", "components", "__tests__")}`,
  `${join("src", "routes", "__test__")}`,
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return listSourceFiles(path);
      }
      return textExtensions.has(path.slice(path.lastIndexOf("."))) ? [path] : [];
    })
    .toSorted();
}

describe("Tabler icons migration", () => {
  const forbiddenPackages = [
    ["lucide", "react"].join("-"),
    "@hugeicons/core-free-icons",
    "@hugeicons/react",
  ];

  it("does not import previous icon packages from app source", () => {
    const offenders = listSourceFiles(sourceRoot)
      .filter((file) => {
        const relativePath = relative(appRoot, file);
        return !testPathMarkers.some((marker) => relativePath.startsWith(marker));
      })
      .filter((file) => {
        const content = readFileSync(file, "utf-8");
        return forbiddenPackages.some(
          (packageName) =>
            content.includes(`"${packageName}"`) || content.includes(`'${packageName}'`),
        );
      })
      .map((file) => relative(appRoot, file));

    expect(offenders).toEqual([]);
  });

  it("does not keep previous icon packages as app dependencies", () => {
    const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    for (const packageName of forbiddenPackages) {
      expect(packageJson.dependencies).not.toHaveProperty(packageName);
      expect(packageJson.devDependencies).not.toHaveProperty(packageName);
    }
  });
});
