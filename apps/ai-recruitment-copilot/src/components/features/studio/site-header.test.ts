import { describe, expect, it } from "vitest";
import { resolveRouteMeta } from "./site-header";

describe("resolveRouteMeta", () => {
  it.each([
    ["/w/demo/studio/calendar", "日程管理"],
    ["/w/demo/studio/dashboard", "数据看板"],
  ])("resolves %s to %s", (pathname, title) => {
    expect(resolveRouteMeta(pathname).title).toBe(title);
  });
});
