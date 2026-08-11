import { describe, expect, it } from "vitest";
import { memberNameInputSchema } from "../schema";

describe("memberNameInputSchema", () => {
  it("trims and accepts names from 1 to 100 characters", () => {
    expect(memberNameInputSchema.parse({ name: "  张三  " })).toEqual({ name: "张三" });
    expect(memberNameInputSchema.safeParse({ name: "名" }).success).toBe(true);
    expect(memberNameInputSchema.safeParse({ name: "名".repeat(100) }).success).toBe(true);
  });

  it("rejects blank names and names longer than 100 characters", () => {
    expect(memberNameInputSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(memberNameInputSchema.safeParse({ name: "名".repeat(101) }).success).toBe(false);
  });
});
