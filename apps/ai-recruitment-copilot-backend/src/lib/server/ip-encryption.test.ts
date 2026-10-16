import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installSecurityTestKeys } from "../../test-utils/security-keys";
import {
  copyIpSnapshot,
  decryptIp,
  encryptIp,
  hideStoredIp,
  ipContext,
  ipLookupHash,
} from "./ip-encryption";

beforeAll(installSecurityTestKeys);
afterAll(() => vi.unstubAllEnvs());
describe("encrypted IP evidence", () => {
  it("uses randomized authenticated encryption and binds the record and workspace", async () => {
    const context = ipContext("telemetry", "org", "record");
    const first = await encryptIp("203.0.113.9", context);
    assert.ok(first);
    const second = await encryptIp("203.0.113.9", context);
    expect(first).not.toBe(second);
    expect(first).not.toContain("203.0.113.9");
    expect(await decryptIp(first, context)).toBe("203.0.113.9");
    await expect(decryptIp(first, ipContext("telemetry", "other", "record"))).rejects.toThrow();
    await expect(decryptIp(first, ipContext("telemetry", "org", "other"))).rejects.toThrow();
    const tampered = first.slice(0, -8) + (first.at(-8) === "A" ? "B" : "A") + first.slice(-7);
    await expect(decryptIp(tampered, context)).rejects.toThrow();
    await expect(decryptIp("203.0.113.9", context)).rejects.toThrow();
  });
  it("retains a bound media snapshot using only the public key", async () => {
    const sourceContext = ipContext("telemetry", "org", "source");
    const targetContext = ipContext("media", "org", "asset");
    const source = await encryptIp("2001:db8::1", sourceContext);
    const privateKey = process.env.IP_ENCRYPTION_PRIVATE_KEY;
    assert.ok(source);
    assert.ok(privateKey);
    vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", "");
    const snapshot = await copyIpSnapshot(source, sourceContext, targetContext);
    assert.ok(snapshot);
    await expect(decryptIp(snapshot, targetContext)).rejects.toThrow();
    vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", privateKey);
    expect(await decryptIp(snapshot, targetContext)).toBe("2001:db8::1");
    await expect(decryptIp(snapshot, ipContext("media", "org", "other-asset"))).rejects.toThrow();
  });
  it("normalizes exact search without exposing hashes or ciphertext in DTOs", () => {
    expect(ipLookupHash("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(
      ipLookupHash("2001:db8::1"),
    );
    expect(
      hideStoredIp({ id: "one", ip: "ip:v1:secret", ipLookupHash: "hash", userAgent: "browser" }),
    ).toEqual({ hasIp: true, id: "one", userAgent: "browser" });
    expect(hideStoredIp({ ip: "203.0.113.9" })).toEqual({ hasIp: true });
  });
  it("fails closed without the encryption configuration", async () => {
    const key = process.env.IP_ENCRYPTION_PUBLIC_KEY;
    assert.ok(key);
    vi.stubEnv("IP_ENCRYPTION_PUBLIC_KEY", "");
    await expect(encryptIp("203.0.113.9", "test")).rejects.toThrow();
    expect(await encryptIp(null, "test")).toBeNull();
    vi.stubEnv("IP_ENCRYPTION_PUBLIC_KEY", key);
  });
});
