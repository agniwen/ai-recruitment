import { createPublicKey } from "node:crypto";
import { CompactEncrypt, compactDecrypt, importPKCS8, importSPKI } from "jose";

export const MEDIA_LOCATION_PREFIX = "media-location:v1:";
const algorithm = "RSA-OAEP-256";
const mediaType = "arc-media-location-v1";

export interface MediaStorageReference {
  id: string;
  meetingId: string;
  organizationId: string;
  storageBackend: "local" | "r2";
}

function required(name: string) {
  const value = process.env[name];
  // Docker run --env-file preserves quotes that Compose/dotenv remove. Reject that
  // mismatch before encrypting rather than creating unreadable record bindings.
  if (!value || value !== value.trim() || /^["']|["']$/.test(value)) {
    throw new Error(`Invalid security configuration: ${name}`);
  }
  return value;
}

function storageContext(reference: MediaStorageReference) {
  return JSON.stringify([
    required("IP_ENCRYPTION_CONTEXT"),
    "interview-media",
    reference.organizationId,
    reference.meetingId,
    reference.id,
    reference.storageBackend,
    "storage-key",
  ]);
}

export async function encryptMediaStorageKey(storageKey: string, reference: MediaStorageReference) {
  const context = storageContext(reference);
  const keyId = required("IP_ENCRYPTION_KEY_ID");
  const pem = Buffer.from(required("IP_ENCRYPTION_PUBLIC_KEY"), "base64").toString("utf-8");
  const publicKey = createPublicKey(pem);
  if (
    publicKey.asymmetricKeyType !== "rsa" ||
    (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072
  ) {
    throw new Error("Media location encryption requires an RSA key of at least 3072 bits");
  }
  const ciphertext = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify({ context, storageKey })),
  )
    .setProtectedHeader({ alg: algorithm, enc: "A256GCM", kid: keyId, typ: mediaType })
    .encrypt(await importSPKI(pem, algorithm));
  return MEDIA_LOCATION_PREFIX + ciphertext;
}

export async function decryptMediaStorageKey(
  ciphertext: string,
  reference: MediaStorageReference,
): Promise<string> {
  if (!ciphertext.startsWith(MEDIA_LOCATION_PREFIX)) {
    throw new Error("Media location requires encryption migration");
  }
  const context = storageContext(reference);
  const pem = Buffer.from(required("IP_ENCRYPTION_PRIVATE_KEY"), "base64").toString("utf-8");
  const { plaintext, protectedHeader } = await compactDecrypt(
    ciphertext.slice(MEDIA_LOCATION_PREFIX.length),
    await importPKCS8(pem, algorithm),
    { contentEncryptionAlgorithms: ["A256GCM"], keyManagementAlgorithms: [algorithm] },
  );
  if (
    protectedHeader.kid !== required("IP_ENCRYPTION_KEY_ID") ||
    protectedHeader.typ !== mediaType
  ) {
    throw new Error("Unexpected media location encryption key or format");
  }
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (
    payload.context !== context ||
    typeof payload.storageKey !== "string" ||
    !payload.storageKey
  ) {
    throw new Error("Invalid media location context");
  }
  return payload.storageKey;
}
