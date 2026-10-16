import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generate } from "otplib";
import { installSecurityTestKeys } from "../../../../test-utils/security-keys";
import { createFactor, createRecoveryCodes, recoveryCodeHash, verifyFactor } from "./crypto";
import { nextMfaFailure } from "./policy";

beforeAll(installSecurityTestKeys);
afterAll(() => vi.unstubAllEnvs());
describe("administrator TOTP", () => {
  it("encrypts each factor and rejects replays and a different account", async () => {
    const factor = await createFactor("admin", "admin@example.invalid");
    const now = new Date("2026-10-16T01:00:00Z");
    const code = await generate({ epoch: now.getTime() / 1000, secret: factor.secret });
    expect(factor.encryptedSecret).not.toContain(factor.secret);
    const args = { code, lastUsedStep: -1, now, secret: factor.encryptedSecret, userId: "admin" };
    const step = await verifyFactor(args);
    expect(step).toBe(Math.floor(now.getTime() / 30_000));
    assert.ok(step !== null);
    expect(await verifyFactor({ ...args, lastUsedStep: step })).toBeNull();
    await expect(verifyFactor({ ...args, userId: "other" })).rejects.toThrow();
    expect(await verifyFactor({ ...args, now: new Date(now.getTime() + 120_000) })).toBeNull();
  });
  it("uses high entropy one-time recovery hashes and a bounded failure window", () => {
    const codes = createRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[a-f0-9]{32}$/.test(code))).toBe(true);
    expect(recoveryCodeHash("admin", codes[0])).not.toBe(recoveryCodeHash("other", codes[0]));
    const now = new Date();
    expect(
      nextMfaFailure({ failedAttempts: 4, failureWindowAt: now }, now).lockedUntil?.getTime(),
    ).toBe(now.getTime() + 900_000);
    expect(
      nextMfaFailure({ failedAttempts: 4, failureWindowAt: new Date(now.getTime() - 301_000) }, now)
        .failedAttempts,
    ).toBe(1);
  });
});
