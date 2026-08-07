import { describe, expect, it } from "vitest";
import { sanitizeApiUrl, sanitizeModelId } from "../sanitize-api-url";

describe("sanitizeApiUrl", () => {
  it("strips zero-width spaces that cause opaque 404s", () => {
    expect(
      sanitizeApiUrl(
        "https://ws-c9lilyi84g4n6qkg.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1\u200B\u200B",
      ),
    ).toBe("https://ws-c9lilyi84g4n6qkg.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
  });

  it("fixes hhttps typo and trailing slashes", () => {
    expect(sanitizeApiUrl("hhttps://example.test/compatible-mode/v1/")).toBe(
      "https://example.test/compatible-mode/v1",
    );
  });

  it("sanitizes model ids", () => {
    expect(sanitizeModelId("qwen-vl-ocr\u200B", "fallback")).toBe("qwen-vl-ocr");
  });
});
