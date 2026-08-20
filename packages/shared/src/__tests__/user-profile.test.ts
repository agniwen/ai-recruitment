import { describe, expect, it } from "vitest";
import { optionalUserTelegramSchema, USER_TELEGRAM_MAX_LENGTH } from "../user-profile";

describe("optionalUserTelegramSchema", () => {
  it("trims TG numbers and normalizes blank values", () => {
    expect(optionalUserTelegramSchema.parse("  @member  ")).toBe("@member");
    expect(optionalUserTelegramSchema.parse("   ")).toBeNull();
    expect(optionalUserTelegramSchema.parse(null)).toBeNull();
  });

  it("rejects values beyond the shared length limit", () => {
    expect(optionalUserTelegramSchema.safeParse("t".repeat(USER_TELEGRAM_MAX_LENGTH)).success).toBe(
      true,
    );
    expect(
      optionalUserTelegramSchema.safeParse("t".repeat(USER_TELEGRAM_MAX_LENGTH + 1)).success,
    ).toBe(false);
  });
});
