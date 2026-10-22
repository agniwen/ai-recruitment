import { describe, expect, it } from "vitest";
import { resolveSscMemberTelegram } from "./member-telegram";

const identity = { email: "ssc@example.com", workspaceRole: "ssc-role" };

function entry(telegram: string, patch: { email?: string; workspaceRole?: string | null } = {}) {
  return { ...identity, telegram, ...patch };
}

describe("SSC member Telegram fallback", () => {
  it("recovers one canonical handle across the same member's repeated responsibilities", () => {
    expect(
      resolveSscMemberTelegram([entry(" @Mixed_Ssc "), entry("mixed_ssc"), entry("   ")], {
        email: " SSC@EXAMPLE.COM ",
        workspaceRole: "ssc-role",
      }),
    ).toBe("@mixed_ssc");
  });

  it("ignores other emails and other roles even when their Telegram values are invalid", () => {
    expect(
      resolveSscMemberTelegram(
        [
          entry("@matching_ssc"),
          entry("invalid link", { email: "other@example.com" }),
          entry("@other_ssc", { email: "prefix-ssc@example.com" }),
          entry("invalid link", { workspaceRole: "other-ssc" }),
          entry("@null_role", { workspaceRole: null }),
        ],
        identity,
      ),
    ).toBe("@matching_ssc");
  });

  it("does not select one of two different handles for the same email and role", () => {
    expect(
      resolveSscMemberTelegram([entry("@first_ssc"), entry("@second_ssc")], identity),
    ).toBeNull();
  });

  it.each([
    "@tiny",
    `@${"a".repeat(33)}`,
    "@12345",
    "@@double_at",
    "@name with spaces",
    "@first_ssc @second_ssc",
    "https://t.me/valid_ssc",
    "@中文账号名称",
    "@Kelvin_K",
    "@valid_ssc\n@other_ssc",
  ])("does not hide an invalid nonblank matching value: %s", (telegram) => {
    expect(resolveSscMemberTelegram([entry(telegram)], identity)).toBeNull();
    expect(resolveSscMemberTelegram([entry("@valid_ssc"), entry(telegram)], identity)).toBeNull();
  });

  it.each(["a1234", "a".repeat(32)])("accepts a valid boundary-length username: %s", (telegram) => {
    expect(resolveSscMemberTelegram([entry(telegram)], identity)).toBe(`@${telegram}`);
  });

  it("returns no contact for missing or blank matching records", () => {
    expect(resolveSscMemberTelegram([], identity)).toBeNull();
    expect(resolveSscMemberTelegram([entry(" \n ")], identity)).toBeNull();
    expect(
      resolveSscMemberTelegram([entry("@unrelated", { email: "other@example.com" })], identity),
    ).toBeNull();
  });

  it("does not associate blank-email preentries with a member", () => {
    expect(
      resolveSscMemberTelegram([entry("@blank_email", { email: " " })], {
        email: "",
        workspaceRole: "ssc-role",
      }),
    ).toBeNull();
  });
});
