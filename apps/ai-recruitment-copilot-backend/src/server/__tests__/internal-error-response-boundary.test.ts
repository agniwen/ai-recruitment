import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routesRoot = path.resolve(import.meta.dirname, "../routes");
const rawInternalErrorResponses = [
  /c\.json\(\s*\{[\s\S]{0,400}?(?:detail|error):\s*(?:error\.message|message|error instanceof Error \? error\.message|String\(error\))[\s\S]{0,400}?\}\s*,\s*(?:500|status(?:\s+as\s+ContentfulStatusCode)?)\s*\)/,
  /c\.json\(\s*\{[\s\S]{0,400}?(?:detail|error):\s*`[^`]*\$\{(?:message|error\.message|String\(error\))\}[^`]*`[\s\S]{0,400}?\}\s*,\s*500\s*\)/,
];

function containsUnsafeInternalResponse(source: string): boolean {
  // Match one response at a time: a public 400 error must never be combined
  // with the status of a later, sanitized 500 response.
  return source
    .split(/(?=c\.json\()/u)
    .some((response) => rawInternalErrorResponses.some((pattern) => pattern.test(response)));
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [entryPath]
      : [];
  });
}

describe("internal error response boundary", () => {
  it("never returns raw internal error messages from 500 handlers", () => {
    const violations = listTypeScriptFiles(routesRoot).flatMap((file) => {
      const source = readFileSync(file, "utf-8");
      return containsUnsafeInternalResponse(source) ? [path.relative(routesRoot, file)] : [];
    });

    expect(violations).toEqual([]);
  });

  it("allows a public validation error before a sanitized internal error response", () => {
    expect(
      containsUnsafeInternalResponse(`
        if (error instanceof InvalidPortfolioFileError) {
          return c.json({ error: error.message }, 400);
        }
        return c.json({ error: "作品集上传失败，请稍后重试。" }, 500);
      `),
    ).toBe(false);
  });

  it.each([
    "c.json({ error: error.message }, 500)",
    "c.json({ error: message }, status)",
    // oxlint-disable-next-line no-template-curly-in-string -- Analyze template source without evaluating it.
    "c.json({ detail: `Failed: ${message}` }, 500)",
    "c.json({ error: error instanceof Error ? error.message : String(error) }, 500)",
  ])("rejects an internal response that exposes an error: %s", (source) => {
    expect(containsUnsafeInternalResponse(source)).toBe(true);
  });
});
