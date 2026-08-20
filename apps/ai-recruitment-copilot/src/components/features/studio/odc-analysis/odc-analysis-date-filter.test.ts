import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("odc-analysis-page.tsx", import.meta.url), "utf-8");
const routeSource = readFileSync(
  new URL("../../../../routes/w.$slug.studio.odc-analysis.tsx", import.meta.url),
  "utf-8",
);

describe("ODC analysis date filters", () => {
  it("uses the shared calendar date picker with reciprocal bounds", () => {
    expect(source).toContain('import { DatePicker } from "@/components/date-time-picker"');
    expect(source).not.toContain('type="date"');
    expect(source).toContain("max={search.to}");
    expect(source).toContain("min={search.from}");
  });
});

describe("ODC analysis demand summary", () => {
  it("does not render requested or expected onboard date cards", () => {
    expect(source).not.toContain('["提需日期",');
    expect(source).not.toContain('["期望到岗日期",');
  });
});

describe("ODC analysis filter loading", () => {
  it("renders filters without a titled card wrapper", () => {
    expect(source).not.toContain("<CardTitle>筛选条件</CardTitle>");
    expect(source).not.toContain("时间范围与角色作用于各指标对应的业务动作");
  });

  it("keeps route loading out of search-param changes and renders a results skeleton", () => {
    expect(routeSource).not.toContain("loaderDeps:");
    expect(routeSource).toContain("useQuery({");
    expect(source).toContain("OdcAnalysisResultsSkeleton");
  });
});
