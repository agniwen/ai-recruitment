// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

const multilineOffer = `【offer信息】
系统记录编码：candidate-local-http
简历名：HTTP 测试候选人

2️⃣薪资信息
转正薪资：30K
试用薪资：27K

面试评价：${"保留完整面试评价及原始换行。".repeat(30)}
尾行

待 SSC 确认`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("clipboard manual fallbacks", () => {
  it("uses the native clipboard when available without opening either manual fallback", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    const manual = vi.fn();

    await expect(copyTextToClipboard(multilineOffer, manual)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(multilineOffer);
    expect(manual).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "denied"])(
    "hands the full multiline text to the custom fallback when native copying is %s",
    async (mode) => {
      const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
      vi.stubGlobal("navigator", {
        clipboard: mode === "denied" ? { writeText } : undefined,
      });
      const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
      const manual = vi.fn();

      await expect(copyTextToClipboard(multilineOffer, manual)).resolves.toBe("manual");
      expect(multilineOffer.length).toBeGreaterThan(256);
      expect(manual).toHaveBeenCalledExactlyOnceWith(multilineOffer);
      expect(manual.mock.lastCall?.[0].split("\n")).toEqual(multilineOffer.split("\n"));
      expect(prompt).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing prompt fallback for callers without a custom fallback", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);

    await expect(copyTextToClipboard("https://example.test/offer")).resolves.toBe("manual");
    expect(prompt).toHaveBeenCalledExactlyOnceWith(
      "复制失败，请手动复制下面的链接",
      "https://example.test/offer",
    );
  });

  it("returns failed when no clipboard or browser fallback is available", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {});

    await expect(copyTextToClipboard(multilineOffer)).resolves.toBe("failed");
  });
});
