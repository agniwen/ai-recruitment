import { createHash, randomBytes } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";
import { generateSecret, generateURI, verify } from "otplib";

function mfaKey() {
  const key = Buffer.from(process.env.ADMIN_MFA_KEY ?? "", "base64");
  if (key.length !== 32) {
    throw new Error("ADMIN_MFA_KEY must contain 32 random bytes encoded as base64");
  }
  return key;
}

export function hashSecurityToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createFactor(userId: string, email: string) {
  const secret = generateSecret();
  const encryptedSecret = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify({ secret, userId })),
  )
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "arc-admin-totp-v1" })
    .encrypt(mfaKey());
  return {
    encryptedSecret,
    secret,
    uri: generateURI({ issuer: "ARC 平台后台", label: email, secret }),
  };
}

async function readFactorSecret(encryptedSecret: string, userId: string): Promise<string> {
  const { plaintext, protectedHeader } = await compactDecrypt(encryptedSecret, mfaKey(), {
    contentEncryptionAlgorithms: ["A256GCM"],
    keyManagementAlgorithms: ["dir"],
  });
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (
    protectedHeader.typ !== "arc-admin-totp-v1" ||
    payload.userId !== userId ||
    typeof payload.secret !== "string"
  ) {
    throw new Error("Invalid MFA secret context");
  }
  return payload.secret;
}

export async function describeFactor(encryptedSecret: string, userId: string, email: string) {
  const secret = await readFactorSecret(encryptedSecret, userId);
  return { secret, uri: generateURI({ issuer: "ARC 平台后台", label: email, secret }) };
}

export async function verifyFactor(input: {
  secret: string;
  userId: string;
  code: string;
  lastUsedStep: number;
  now: Date;
}) {
  const result = await verify({
    afterTimeStep: input.lastUsedStep >= 0 ? input.lastUsedStep : undefined,
    epoch: Math.floor(input.now.getTime() / 1000),
    epochTolerance: 30,
    secret: await readFactorSecret(input.secret, input.userId),
    strategy: "totp",
    token: input.code,
  });
  return result.valid && "timeStep" in result ? result.timeStep : null;
}

export function createRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(16).toString("hex"));
}

export function recoveryCodeHash(userId: string, code: string) {
  return hashSecurityToken(`arc-mfa-recovery:${userId}:${code.toLowerCase()}`);
}
