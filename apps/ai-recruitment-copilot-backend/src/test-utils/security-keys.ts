import { generateKeyPairSync, randomBytes } from "node:crypto";
import { vi } from "vitest";

// Ephemeral test-only keys. Never read deployment secrets or persist these keys.
export function installSecurityTestKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  vi.stubEnv("IP_ENCRYPTION_CONTEXT", "isolated-test");
  vi.stubEnv("IP_ENCRYPTION_KEY_ID", "test-key");
  vi.stubEnv(
    "IP_ENCRYPTION_PUBLIC_KEY",
    Buffer.from(publicKey.export({ format: "pem", type: "spki" })).toString("base64"),
  );
  vi.stubEnv(
    "IP_ENCRYPTION_PRIVATE_KEY",
    Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" })).toString("base64"),
  );
  vi.stubEnv("IP_LOOKUP_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("ADMIN_MFA_KEY", randomBytes(32).toString("base64"));
}
