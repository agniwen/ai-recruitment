import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("odc-analysis-page.tsx", import.meta.url), "utf-8");
const routeSource = readFileSync(
  new URL("../../../../routes/w.$slug.studio.odc-analysis.tsx", import.meta.url),
  "utf-8",
);

describe("ODC analysis date filters", () => {
  it("renders independent demand, progress, and activity filter groups", () => {
    expect(source).toContain('import { DatePicker } from "@/components/date-time-picker"');
    expect(source).not.toContain('type="date"');
    expect(source).toContain("demandDateField");
    expect(source).toContain("progressJdIds");
    expect(source).toContain("activityDate");
  });
});

describe("ODC analysis demand summary", () => {
  it("offers requested and expected onboard date filtering", () => {
    expect(source).toContain("提需求日期");
    expect(source).toContain("期望到岗日期");
  });
});

describe("ODC analysis filter loading", () => {
  it("renders filters without a titled card wrapper", () => {
    expect(source).not.toContain("<CardTitle>筛选条件</CardTitle>");
    expect(source).not.toContain("角色");
  });

  it("keeps route loading out of search-param changes and queries each section independently", () => {
    expect(routeSource).not.toContain("loaderDeps:");
    expect(routeSource.match(/useQuery\(\{/gu)).toHaveLength(3);
    expect(routeSource).toContain('"demand"');
    expect(routeSource).toContain('"overall"');
    expect(routeSource).toContain('"activity"');
    expect(source).toContain("DemandResultsSkeleton");
    expect(source).toContain("MetricsResultsSkeleton");
    expect(source).toContain("ActivityResultsSkeleton");
    expect(source).not.toContain("dataLoading");
  });

  it("renames the third section and creates drilldown links", () => {
    expect(source).toContain('title="当日动态"');
    expect(source).toContain('to="/w/$slug/studio/job-descriptions"');
    expect(source).toContain('to="/w/$slug/studio/resumes"');
  });
});
