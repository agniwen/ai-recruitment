import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("data-export-page.tsx", import.meta.url), "utf-8");
const pathsSource = readFileSync(
  new URL("../../../../lib/start/studio-page-paths.ts", import.meta.url),
  "utf-8",
);

describe("data export permissions", () => {
  it("uses a dedicated page permission for menu and route access", () => {
    expect(pathsSource).toContain('{ action: "dataExport", path: "/data-export" }');
  });

  it("requires the export action before showing export controls", () => {
    expect(pageSource).toContain('useHasPermission("dataExport", "export")');
    expect(pageSource.match(/canExportData \? \(/g)).toHaveLength(2);
  });
});
