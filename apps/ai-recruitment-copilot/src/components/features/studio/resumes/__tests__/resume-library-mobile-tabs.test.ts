import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../resume-library-page.tsx", import.meta.url), "utf-8");

describe("ResumeLibraryPage mobile stage tabs", () => {
  it("makes pipeline stage tabs fill the mobile viewport width", () => {
    expect(source).toMatch(/<TabsList className="[^"]*grid-cols-2[^"]*"/u);
    expect(source).toContain("data-[orientation=horizontal]:h-auto");
    expect(source).toContain("sm:inline-flex");
    expect(source).toContain("w-full flex-col");
  });
});
