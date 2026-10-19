interface UUIDCrypto {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
  randomUUID?: Crypto["randomUUID"];
}

export function installRandomUUIDPolyfill(cryptoApi: UUIDCrypto): void {
  if (typeof cryptoApi.randomUUID === "function") {
    return;
  }
  Object.defineProperty(cryptoApi, "randomUUID", {
    configurable: true,
    value(): ReturnType<Crypto["randomUUID"]> {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] % 16) + 64;
      bytes[8] = (bytes[8] % 64) + 128;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    writable: true,
  });
}
