import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("resume-pool-details.tsx", import.meta.url), "utf-8");

describe("ResumePoolDetailSummaryPanel", () => {
  it("keeps the candidate summary background transparent", () => {
    const summaryPanelSource = source.slice(
      source.indexOf("function ResumePoolDetailSummaryPanel"),
      source.indexOf("function ResumePoolStructuredInfoPanel"),
    );

    expect(summaryPanelSource).toContain('<section className="space-y-6 rounded-2xl">');
    expect(summaryPanelSource).not.toContain("bg-muted");
  });
});
