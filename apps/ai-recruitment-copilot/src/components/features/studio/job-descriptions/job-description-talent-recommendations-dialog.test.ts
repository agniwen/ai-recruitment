import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("job-description-talent-recommendations-dialog.tsx", import.meta.url),
  "utf-8",
);

describe("job description talent recommendations export", () => {
  it("shows the export action in the modal footer only when recommendations exist", () => {
    expect(source).toContain("footer={");
    expect(source).toContain("导出推荐人才");
    expect(source).toContain("data.candidates.length > 0");
  });

  it("reuses the column-picker export dialog with the 50-row recommendation cap", () => {
    expect(source).toContain("DataExportDialog");
    expect(source).toContain("showRange={false}");
    expect(source).toContain("JOB_DESCRIPTION_TALENT_RECOMMENDATION_MAX_LIMIT");
    expect(source).toContain("talentRecommendationExportColumns");
    expect(source).toContain('source="talentRecommendations"');
  });
});
