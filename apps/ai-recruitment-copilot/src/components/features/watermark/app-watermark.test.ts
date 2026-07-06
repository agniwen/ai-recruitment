import { describe, expect, it } from "vitest";
import { buildWatermarkContent } from "./app-watermark";

describe("app watermark content", () => {
  it("uses name as the first line and masked id as the second line", () => {
    expect(
      buildWatermarkContent({
        email: "user.name+hr@example.com",
        id: "user_1234567890",
        name: "王小明",
      }),
    ).toEqual(["王小明", "ID: user****7890"]);
  });

  it("falls back to email when name is blank", () => {
    expect(
      buildWatermarkContent({
        email: "fallback@example.com",
        id: "user_1",
        name: " ",
      }),
    ).toEqual(["fallback@example.com", "ID: user_1"]);
  });

  it("falls back to user when name and email are blank", () => {
    expect(
      buildWatermarkContent({
        email: " ",
        id: "user_2",
        name: " ",
      }),
    ).toEqual(["用户", "ID: user_2"]);
  });
});
