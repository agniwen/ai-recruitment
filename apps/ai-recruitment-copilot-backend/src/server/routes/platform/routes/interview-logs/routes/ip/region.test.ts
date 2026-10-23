import { describe, expect, it, vi } from "vitest";
import { lookupIpRegion } from "./region";

describe("offline Chinese IP regions", () => {
  it("resolves the locally observed public IPv4 to a Chinese region", () => {
    expect(lookupIpRegion("183.23.191.9")).toBe("中国 · 广东省 · 东莞市 · 电信");
  });
  it("supports public IPv6 and foreign country names", () => {
    expect(lookupIpRegion("240e:47d:c20:1627:30a3:ba0d:a5e6:ec19")).toContain("中国 · 广东省");
    expect(lookupIpRegion("8.8.8.8")).toContain("美国");
  });
  it.each(["", "bad-ip", "127.0.0.1", "192.168.1.1", "::1", "203.0.113.10"])(
    "does not assign a public region to %s",
    (ip) => expect(lookupIpRegion(ip)).toBeNull(),
  );
  it("does not use an ISP-only Anycast entry as a geographic location", () => {
    expect(lookupIpRegion("2606:4700::1111")).toBeNull();
  });
  it("does not call an external IP lookup service", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      expect(lookupIpRegion("183.23.191.9")).toContain("广东省");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
