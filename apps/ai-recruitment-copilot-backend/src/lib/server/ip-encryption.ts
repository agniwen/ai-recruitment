import { createHash, createHmac, createPublicKey } from "node:crypto";
import { isIP } from "node:net";
import { CompactEncrypt, compactDecrypt, importPKCS8, importSPKI } from "jose";

const PREFIX = "ip:v1:";
const ALGORITHM = "RSA-OAEP-256";
const encoder = new TextEncoder();

export function ipContext(kind: string, scope: string, id: string) {
  return JSON.stringify([process.env.IP_ENCRYPTION_CONTEXT ?? "arc", kind, scope, id, "ip"]);
}

export function sessionIpContext(userId: string, token: string) {
  return ipContext("session", userId, createHash("sha256").update(token).digest("hex"));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing security configuration: ${name}`);
  }
  return value;
}

export function normalizeIp(ip: string) {
  if (!isIP(ip)) {
    throw new Error("Invalid IP address");
  }
  // URL canonicalizes IPv6 (including alternate zero compression) for exact lookup.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}

export function ipLookupHash(ip: string) {
  const key = Buffer.from(required("IP_LOOKUP_KEY"), "base64");
  if (key.length !== 32) {
    throw new Error("IP_LOOKUP_KEY must contain 32 random bytes encoded as base64");
  }
  return createHmac("sha256", key).update(normalizeIp(ip)).digest("hex");
}

export function isEncryptedIp(value: string) {
  return value.startsWith(PREFIX);
}

async function seal(value: unknown, context: string) {
  const pem = Buffer.from(required("IP_ENCRYPTION_PUBLIC_KEY"), "base64").toString("utf-8");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    throw new Error("IP encryption requires an RSA key of at least 3072 bits");
  }
  const ciphertext = await new CompactEncrypt(encoder.encode(JSON.stringify({ context, value })))
    .setProtectedHeader({
      alg: ALGORITHM,
      enc: "A256GCM",
      kid: required("IP_ENCRYPTION_KEY_ID"),
      typ: "arc-ip-v1",
    })
    .encrypt(await importSPKI(pem, ALGORITHM));
  return PREFIX + ciphertext;
}

export function encryptIp(ip: string | null | undefined, context: string) {
  return ip ? seal(normalizeIp(ip), context) : Promise.resolve(null);
}

// A media worker can retain an independently bound snapshot using only the public key.
export function copyIpSnapshot(ip: string, sourceContext: string, targetContext: string) {
  return isEncryptedIp(ip)
    ? seal({ ciphertext: ip, sourceContext }, targetContext)
    : encryptIp(ip, targetContext);
}

export async function decryptIp(ciphertext: string, context: string, depth = 0): Promise<string> {
  if (!isEncryptedIp(ciphertext) || depth > 1) {
    throw new Error("IP is not encrypted or requires migration");
  }
  const pem = Buffer.from(required("IP_ENCRYPTION_PRIVATE_KEY"), "base64").toString("utf-8");
  const { plaintext, protectedHeader } = await compactDecrypt(
    ciphertext.slice(PREFIX.length),
    await importPKCS8(pem, ALGORITHM),
    { contentEncryptionAlgorithms: ["A256GCM"], keyManagementAlgorithms: [ALGORITHM] },
  );
  if (
    protectedHeader.kid !== required("IP_ENCRYPTION_KEY_ID") ||
    protectedHeader.typ !== "arc-ip-v1"
  ) {
    throw new Error("Unexpected IP encryption key or format");
  }
  const data = JSON.parse(new TextDecoder().decode(plaintext));
  if (data.context !== context) {
    throw new Error("IP encryption context mismatch");
  }
  if (typeof data.value === "string") {
    return normalizeIp(data.value);
  }
  if (
    depth === 0 &&
    typeof data.value?.ciphertext === "string" &&
    typeof data.value.sourceContext === "string"
  ) {
    return decryptIp(data.value.ciphertext, data.value.sourceContext, depth + 1);
  }
  throw new Error("Invalid encrypted IP payload");
}

export function hideStoredIp<T extends { ip?: string | null; ipLookupHash?: string | null }>(
  row: T,
) {
  const { ip, ipLookupHash: _lookup, ...publicRow } = row;
  return { ...publicRow, hasIp: Boolean(ip) };
}
