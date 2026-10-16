import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  platformMfaFactor as factor,
  platformMfaGrant as grant,
  platformSecurityAudit as audit,
} from "@arc/db-schema/schema";
import {
  createFactor,
  createRecoveryCodes,
  describeFactor,
  recoveryCodeHash,
  verifyFactor,
} from "./crypto";
import { ENROLLMENT_VALIDITY_MS } from "./policy";
import {
  currentAdmin,
  issueMfaGrant,
  recordMfaFailure,
  requireRecentMfa,
  SecurityError,
} from "./service";
import type { SecurityPrincipal } from "./service";

export async function beginMfaReplacement(principal: SecurityPrincipal, headers: Headers) {
  await requireRecentMfa(principal, headers);
  return db.transaction(async (tx) => {
    const admin = await currentAdmin(principal, tx);
    const [row] = await tx
      .select()
      .from(factor)
      .where(eq(factor.userId, principal.userId))
      .for("update");
    if (!row?.verifiedAt) {
      throw new SecurityError("MFA_ENROLLMENT_REQUIRED", "请先绑定身份验证器。");
    }
    if (row.lockedUntil && row.lockedUntil > new Date()) {
      throw new SecurityError("MFA_LOCKED", "尝试次数过多，请稍后重试。", 429);
    }
    if (
      row.pendingSecret &&
      row.pendingSessionId === principal.sessionId &&
      row.pendingExpiresAt &&
      row.pendingExpiresAt > new Date()
    ) {
      return describeFactor(row.pendingSecret, principal.userId, admin.email);
    }
    const created = await createFactor(principal.userId, admin.email);
    await tx
      .update(factor)
      .set({
        pendingExpiresAt: new Date(Date.now() + ENROLLMENT_VALIDITY_MS),
        pendingSecret: created.encryptedSecret,
        pendingSessionId: principal.sessionId,
      })
      .where(eq(factor.userId, principal.userId));
    await tx.insert(audit).values({
      action: "mfa.replace.begin",
      actorId: principal.userId,
      id: randomUUID(),
      outcome: "success",
      sessionId: principal.sessionId,
    });
    return { secret: created.secret, uri: created.uri };
  });
}

export async function confirmMfaReplacement(
  principal: SecurityPrincipal,
  headers: Headers,
  code: string,
) {
  const authorizationExpiresAt = await requireRecentMfa(principal, headers);
  const result = await db.transaction(async (tx) => {
    await currentAdmin(principal, tx);
    const [row] = await tx
      .select()
      .from(factor)
      .where(eq(factor.userId, principal.userId))
      .for("update");
    const now = new Date();
    if (new Date(authorizationExpiresAt) <= now) {
      throw new SecurityError("MFA_REQUIRED", "请先完成两步验证。");
    }
    if (
      !row?.pendingSecret ||
      row.pendingSessionId !== principal.sessionId ||
      !row.pendingExpiresAt ||
      row.pendingExpiresAt <= now
    ) {
      throw new SecurityError("MFA_REPLACEMENT_REQUIRED", "更换请求已过期，请重新开始。", 409);
    }
    if (row.lockedUntil && row.lockedUntil > now) {
      throw new SecurityError("MFA_LOCKED", "尝试次数过多，请稍后重试。", 429);
    }
    const step = await verifyFactor({
      code,
      lastUsedStep: -1,
      now,
      secret: row.pendingSecret,
      userId: principal.userId,
    });
    if (step === null) {
      return { error: await recordMfaFailure(tx, principal, row, now) };
    }
    const recoveryCodes = createRecoveryCodes();
    await tx
      .update(factor)
      .set({
        enrollmentExpiresAt: null,
        enrollmentSessionId: null,
        failedAttempts: 0,
        failureWindowAt: null,
        lastUsedStep: step,
        lockedUntil: null,
        pendingExpiresAt: null,
        pendingSecret: null,
        pendingSessionId: null,
        recoveryCodeHashes: recoveryCodes.map((value) => recoveryCodeHash(principal.userId, value)),
        secret: row.pendingSecret,
        verifiedAt: now,
      })
      .where(eq(factor.userId, principal.userId));
    await tx.delete(grant).where(eq(grant.userId, principal.userId));
    const authorization = await issueMfaGrant(tx, principal, now);
    await tx.insert(audit).values({
      action: "mfa.replace.confirm",
      actorId: principal.userId,
      id: randomUUID(),
      outcome: "success",
      sessionId: principal.sessionId,
    });
    return { ...authorization, recoveryCodes };
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}
