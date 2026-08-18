import { describe, expect, it } from "vitest";
import { resolveRouteMeta } from "./site-header";

describe("resolveRouteMeta", () => {
  it.each([
    ["/w/demo/studio/resumes", "候选人管理"],
    ["/w/demo/studio/resume-pool", "简历池"],
    ["/w/demo/studio/data-export", "导出数据"],
    ["/w/demo/studio/calendar", "面试日程"],
    ["/w/demo/studio/dashboard", "招聘看板"],
    ["/w/demo/studio/odc-analysis", "ODC分析"],
  ])("resolves %s to %s", (pathname, title) => {
    expect(resolveRouteMeta(pathname).title).toBe(title);
  });
});
