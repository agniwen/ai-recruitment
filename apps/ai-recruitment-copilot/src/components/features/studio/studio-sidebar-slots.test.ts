import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("studio-sidebar-slots.tsx", import.meta.url), "utf-8");

describe("Studio sidebar menu items", () => {
  it("provides subtle press feedback and de-emphasizes inactive items", () => {
    expect(source).toContain("active:scale-[0.98]");
    expect(source).toContain("data-[active=false]:opacity-90");
    expect(source).toContain("data-[active=false]:hover:opacity-100");
    expect(source).toContain("motion-reduce:active:scale-100");
  });

  it("places schedule management immediately above the dashboard", () => {
    expect(source.indexOf('title: "面试日程"')).toBeGreaterThan(
      source.indexOf('title: "AI 面试管理"'),
    );
    expect(source.indexOf('title: "面试日程"')).toBeLessThan(source.indexOf('title: "招聘看板"'));
  });

  it("uses the resume library and resume plaza product labels", () => {
    expect(source).toContain('title: "候选人管理"');
    expect(source).toContain('title: "简历池"');
    expect(source).not.toContain('title: "招聘"');
    expect(source).not.toContain('title: "人才库"');
  });
});
