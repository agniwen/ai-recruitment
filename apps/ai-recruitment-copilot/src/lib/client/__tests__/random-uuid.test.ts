import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { installRandomUUIDPolyfill } from "../random-uuid";

describe("browser UUID compatibility", () => {
  it("installs RFC 4122 version 4 UUIDs when HTTP omits the native method", () => {
    const cryptoApi = {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: undefined as Crypto["randomUUID"] | undefined,
    };
    installRandomUUIDPolyfill(cryptoApi);

    const ids = Array.from({ length: 32 }, () => cryptoApi.randomUUID?.());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    }
    expect(new Set(ids).size).toBe(32);
  });

  it("does not replace a native UUID implementation", () => {
    const nativeRandomUUID = webcrypto.randomUUID.bind(webcrypto);
    const cryptoApi = {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: nativeRandomUUID,
    };
    installRandomUUIDPolyfill(cryptoApi);
    expect(cryptoApi.randomUUID).toBe(nativeRandomUUID);
  });

  it("uses cryptographic randomness without falling back to Math.random", () => {
    const cryptoApi = {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      randomUUID: undefined as Crypto["randomUUID"] | undefined,
    };
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Non-cryptographic randomness must not be used");
    });
    try {
      installRandomUUIDPolyfill(cryptoApi);
      expect(cryptoApi.randomUUID?.()).toMatch(/^.{14}4.{3}-[89ab]/u);
    } finally {
      random.mockRestore();
    }
  });
});
