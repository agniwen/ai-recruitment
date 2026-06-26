import { describe, expect, it } from "vitest";
import { buildWatermarkContent } from "./app-watermark";

describe("app watermark content", () => {
  it("uses name as the first line and full email as the second line", () => {
    expect(
      buildWatermarkContent({
        email: "user.name+hr@example.com",
        name: "王小明",
      }),
    ).toEqual(["王小明", "user.name+hr@example.com"]);
  });

  it("falls back to user when name is blank", () => {
    expect(
      buildWatermarkContent({
        email: "fallback@example.com",
        name: " ",
      }),
    ).toEqual(["用户", "fallback@example.com"]);
  });

  it("does not render content without an email", () => {
    expect(
      buildWatermarkContent({
        email: " ",
        name: "王小明",
      }),
    ).toBeNull();
  });
});
