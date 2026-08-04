import { describe, expect, it } from "vitest";
import { AUTH_RATE_LIMIT } from "../auth-rate-limit";

describe("AUTH_RATE_LIMIT", () => {
  it("allows the planned 50-user email sign-in burst from one egress IP", () => {
    expect(AUTH_RATE_LIMIT.customRules["/sign-in/email"]).toEqual({
      max: 60,
      window: 10,
    });
  });

  it("does not replace the global Better Auth rate-limit defaults", () => {
    expect(AUTH_RATE_LIMIT).not.toHaveProperty("enabled");
    expect(AUTH_RATE_LIMIT).not.toHaveProperty("max");
    expect(AUTH_RATE_LIMIT).not.toHaveProperty("window");
  });
});
