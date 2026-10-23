import { describe, expect, it } from "vitest";
import { normalizeProtectionIdentity, protectionIdentityMatch } from "./policy";

const identity = normalizeProtectionIdentity({
  contentHash: "a",
  email: " A@EXAMPLE.COM ",
  name: "陈 安",
  phone: "+86 138-0000-0000",
});
describe("recommendation protection identity", () => {
  it("normalizes identity and accepts renamed copies of the same file", () => {
    expect(identity).toEqual({
      contentHash: "a",
      email: "a@example.com",
      name: "陈安",
      phone: "13800000000",
    });
    expect(
      protectionIdentityMatch(identity, { ...identity, email: null, name: null, phone: null }),
    ).toBe("简历文件内容一致");
  });
  it("matches a different file using corroborated identity", () => {
    expect(protectionIdentityMatch(identity, { ...identity, contentHash: "b" })).toBe(
      "姓名及手机号一致",
    );
  });
  it("does not equate a shared name or conflicting contacts with the same candidate", () => {
    expect(
      protectionIdentityMatch(identity, { ...identity, contentHash: "b", phone: "12345678" }),
    ).toBeNull();
    expect(
      protectionIdentityMatch(identity, {
        ...identity,
        contentHash: "b",
        email: null,
        phone: null,
      }),
    ).toBeNull();
    expect(
      protectionIdentityMatch(identity, { ...identity, contentHash: "b", name: "其他人" }),
    ).toBeNull();
  });
});
