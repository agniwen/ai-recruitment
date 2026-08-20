import { describe, expect, it } from "vitest";
import { memberProfileInputSchema } from "../schema";

describe("memberProfileInputSchema", () => {
  it("trims valid profile fields and converts a blank TG number to null", () => {
    expect(memberProfileInputSchema.parse({ name: "  张三  ", telegram: "  @zhangsan  " })).toEqual(
      {
        name: "张三",
        telegram: "@zhangsan",
      },
    );
    expect(memberProfileInputSchema.parse({ name: "张三", telegram: "   " })).toEqual({
      name: "张三",
      telegram: null,
    });
  });

  it("rejects invalid names and TG numbers longer than 120 characters", () => {
    expect(memberProfileInputSchema.safeParse({ name: "   ", telegram: null }).success).toBe(false);
    expect(
      memberProfileInputSchema.safeParse({ name: "名".repeat(101), telegram: null }).success,
    ).toBe(false);
    expect(
      memberProfileInputSchema.safeParse({ name: "张三", telegram: "t".repeat(121) }).success,
    ).toBe(false);
  });
});
