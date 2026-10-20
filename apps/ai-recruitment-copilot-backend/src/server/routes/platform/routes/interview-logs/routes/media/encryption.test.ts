import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installSecurityTestKeys } from "../../../../../../../test-utils/security-keys";
import { decryptMediaStorageKey, encryptMediaStorageKey } from "./encryption";

const reference = {
  id: "asset-one",
  meetingId: "meeting-one",
  organizationId: "organization-one",
  storageBackend: "r2" as const,
};
const storageKey = "human-interview-samples/01234567-89ab-cdef-0123-456789abcdef.jpg";

beforeAll(installSecurityTestKeys);
afterAll(() => vi.unstubAllEnvs());

describe("encrypted interview media locations", () => {
  it("randomizes ciphertext and binds it to the organization, meeting, asset and storage backend", async () => {
    const first = await encryptMediaStorageKey(storageKey, reference);
    expect(first).toMatch(/^media-location:v1:/);
    expect(first).not.toContain(storageKey);
    expect(await encryptMediaStorageKey(storageKey, reference)).not.toBe(first);
    expect(await decryptMediaStorageKey(first, reference)).toBe(storageKey);
    for (const changed of [
      { id: "other-asset" },
      { meetingId: "other-meeting" },
      { organizationId: "other-organization" },
      { storageBackend: "local" as const },
    ]) {
      await expect(decryptMediaStorageKey(first, { ...reference, ...changed })).rejects.toThrow();
    }
    const tampered = first.slice(0, -8) + (first.at(-8) === "A" ? "B" : "A") + first.slice(-7);
    await expect(decryptMediaStorageKey(tampered, reference)).rejects.toThrow();
    await expect(decryptMediaStorageKey(storageKey, reference)).rejects.toThrow();
  });

  it("lets the capture worker encrypt with only the public key", async () => {
    const privateKey = process.env.IP_ENCRYPTION_PRIVATE_KEY;
    vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", "");
    try {
      const ciphertext = await encryptMediaStorageKey(storageKey, reference);
      await expect(decryptMediaStorageKey(ciphertext, reference)).rejects.toThrow();
    } finally {
      vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", privateKey);
    }
  });

  it("fails before writing ciphertext when configuration contains literal env-file quotes", async () => {
    for (const key of [
      "IP_ENCRYPTION_CONTEXT",
      "IP_ENCRYPTION_KEY_ID",
      "IP_ENCRYPTION_PUBLIC_KEY",
    ]) {
      const original = process.env[key];
      vi.stubEnv(key, `'${original}'`);
      try {
        await expect(encryptMediaStorageKey(storageKey, reference)).rejects.toThrow(
          "Invalid security configuration",
        );
      } finally {
        vi.stubEnv(key, original);
      }
    }
  });
});
