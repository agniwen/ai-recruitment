import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  platformMfaFactor as factor,
  platformMfaGrant as grant,
  platformSecurityAudit as audit,
  session,
  user,
} from "@arc/db-schema/schema";
import { MFA_VALIDITY_SECONDS } from "@arc/shared/platform-security";
import type { MfaCode, MfaStatus } from "@arc/shared/platform-security";
import {
  createFactor,
  createRecoveryCodes,
  describeFactor,
  hashSecurityToken,
  recoveryCodeHash,
  verifyFactor,
} from "./crypto";
import { ENROLLMENT_VALIDITY_MS, nextMfaFailure, readMfaCookie } from "./policy";

export class SecurityError extends Error {
  readonly code: string;
  readonly status: 401 | 403 | 409 | 429;
  constructor(code: string, message: string, status: 401 | 403 | 409 | 429 = 403) {
    super(message);
    this.name = "SecurityError";
    this.code = code;
    this.status = status;
  }
}

export interface SecurityPrincipal {
  userId: string;
  sessionId: string;
}
export function securityPrincipal(context: {
  user: { id: string } | null;
  session: { id: string } | null;
}): SecurityPrincipal {
  if (!context.user || !context.session) {
    throw new SecurityError("UNAUTHORIZED", "请先登录。", 401);
  }
  return { sessionId: context.session.id, userId: context.user.id };
}
function enrollmentIsValid(row: typeof factor.$inferSelect, sessionId: string, now: Date) {
  return Boolean(
    row.verifiedAt ||
    (row.enrollmentSessionId === sessionId &&
      row.enrollmentExpiresAt &&
      row.enrollmentExpiresAt > now),
  );
}
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function currentAdmin(
  principal: SecurityPrincipal,
  connection: Transaction | typeof db = db,
) {
  const query = connection
    .select({
      email: user.email,
      impersonatedBy: session.impersonatedBy,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(
        eq(session.id, principal.sessionId),
        eq(session.userId, principal.userId),
        gt(session.expiresAt, new Date()),
        eq(user.role, "admin"),
        eq(user.banned, false),
      ),
    )
    .limit(1);
  const [row] = await (connection === db ? query : query.for("update"));
  if (!row || row.impersonatedBy) {
    throw new SecurityError("FORBIDDEN", "当前账户不能访问平台后台。");
  }
  return row;
}

export async function getMfaStatus(
  principal: SecurityPrincipal,
  headers: Headers,
): Promise<MfaStatus> {
  await currentAdmin(principal);
  const [row] = await db
    .select({ verifiedAt: factor.verifiedAt })
    .from(factor)
    .where(eq(factor.userId, principal.userId));
  const token = readMfaCookie(headers);
  const [active] =
    row?.verifiedAt && token
      ? await db
          .select({ expiresAt: grant.expiresAt })
          .from(grant)
          .where(
            and(
              eq(grant.userId, principal.userId),
              eq(grant.sessionId, principal.sessionId),
              eq(grant.tokenHash, hashSecurityToken(token)),
              gt(grant.expiresAt, new Date()),
            ),
          )
      : [];
  return {
    enrolled: Boolean(row?.verifiedAt),
    expiresAt: active?.expiresAt.toISOString() ?? null,
  };
}

export async function requireRecentMfa(principal: SecurityPrincipal, headers: Headers) {
  const state = await getMfaStatus(principal, headers);
  if (!state.expiresAt) {
    throw new SecurityError(
      state.enrolled ? "MFA_REQUIRED" : "MFA_ENROLLMENT_REQUIRED",
      state.enrolled ? "请先完成两步验证。" : "请先绑定身份验证器。",
    );
  }
  return state.expiresAt;
}

export async function renewMfaActivity(
  principal: SecurityPrincipal,
  headers: Headers,
  activeAt: number,
) {
  await requireRecentMfa(principal, headers);
  const token = readMfaCookie(headers);
  if (!token) {
    throw new SecurityError("MFA_REQUIRED", "请先完成两步验证。");
  }
  const now = new Date();
  const expiresAt = new Date(Math.min(activeAt, now.getTime()) + MFA_VALIDITY_SECONDS * 1000);
  const [active] = await db
    .update(grant)
    .set({ expiresAt: sql`greatest(${grant.expiresAt}, ${expiresAt.toISOString()}::timestamptz)` })
    .where(
      and(
        eq(grant.userId, principal.userId),
        eq(grant.sessionId, principal.sessionId),
        eq(grant.tokenHash, hashSecurityToken(token)),
        gt(grant.expiresAt, now),
      ),
    )
    .returning({ expiresAt: grant.expiresAt });
  if (!active) {
    throw new SecurityError("MFA_REQUIRED", "请先完成两步验证。");
  }
  return { expiresAt: active.expiresAt.toISOString(), token };
}

export function beginMfaEnrollment(principal: SecurityPrincipal) {
  return db.transaction(async (tx) => {
    const admin = await currentAdmin(principal, tx);
    // Serialize even the first enrollment, when no factor row exists yet.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, principal.userId)).for("update");
    const [existing] = await tx
      .select()
      .from(factor)
      .where(eq(factor.userId, principal.userId))
      .for("update");
    if (existing?.verifiedAt) {
      throw new SecurityError("MFA_ALREADY_ENROLLED", "已绑定验证器，请输入验证码。", 409);
    }
    if (existing?.lockedUntil && existing.lockedUntil > new Date()) {
      throw new SecurityError("MFA_LOCKED", "尝试次数过多，请在 15 分钟后重试。", 429);
    }
    if (existing && enrollmentIsValid(existing, principal.sessionId, new Date())) {
      return describeFactor(existing.secret, principal.userId, admin.email);
    }
    const created = await createFactor(principal.userId, admin.email);
    const values = {
      enrollmentExpiresAt: new Date(Date.now() + ENROLLMENT_VALIDITY_MS),
      enrollmentSessionId: principal.sessionId,
      secret: created.encryptedSecret,
      userId: principal.userId,
    };
    await tx
      .insert(factor)
      .values(values)
      .onConflictDoUpdate({ set: values, target: factor.userId });
    await tx.insert(audit).values({
      action: "mfa.enroll.begin",
      actorId: principal.userId,
      id: randomUUID(),
      outcome: "success",
      sessionId: principal.sessionId,
    });
    return { secret: created.secret, uri: created.uri };
  });
}

export async function recordMfaFailure(
  tx: Transaction,
  principal: SecurityPrincipal,
  row: typeof factor.$inferSelect,
  now: Date,
) {
  const failure = nextMfaFailure(row, now);
  await tx.update(factor).set(failure).where(eq(factor.userId, principal.userId));
  await tx.insert(audit).values({
    action: "mfa.verify",
    actorId: principal.userId,
    id: randomUUID(),
    outcome: "denied",
    sessionId: principal.sessionId,
  });
  return new SecurityError(
    failure.lockedUntil ? "MFA_LOCKED" : "MFA_INVALID_CODE",
    failure.lockedUntil
      ? "尝试次数过多，请在 15 分钟后重试。"
      : "验证码无效或已使用，请输入新的验证码。",
    failure.lockedUntil ? 429 : 401,
  );
}

export async function issueMfaGrant(tx: Transaction, principal: SecurityPrincipal, now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + MFA_VALIDITY_SECONDS * 1000);
  const values = {
    expiresAt,
    sessionId: principal.sessionId,
    tokenHash: hashSecurityToken(token),
    userId: principal.userId,
    verifiedAt: now,
  };
  await tx
    .insert(grant)
    .values(values)
    .onConflictDoUpdate({ set: values, target: grant.sessionId });
  return { expiresAt: expiresAt.toISOString(), token };
}

export async function verifyMfa(principal: SecurityPrincipal, input: MfaCode) {
  const result = await db.transaction(async (tx) => {
    await currentAdmin(principal, tx);
    const [row] = await tx
      .select()
      .from(factor)
      .where(eq(factor.userId, principal.userId))
      .for("update");
    const now = new Date();
    if (!row || !enrollmentIsValid(row, principal.sessionId, now)) {
      return { error: new SecurityError("MFA_ENROLLMENT_REQUIRED", "请重新开始绑定验证器。") };
    }
    if (row.lockedUntil && row.lockedUntil > now) {
      return { error: new SecurityError("MFA_LOCKED", "尝试次数过多，请稍后重试。", 429) };
    }
    const step =
      input.method === "totp"
        ? await verifyFactor({
            code: input.code,
            lastUsedStep: row.lastUsedStep,
            now,
            secret: row.secret,
            userId: principal.userId,
          })
        : null;
    const recoveryHash =
      input.method === "recovery" ? recoveryCodeHash(principal.userId, input.code) : null;
    const recoveryValid = Boolean(
      row.verifiedAt && recoveryHash && row.recoveryCodeHashes.includes(recoveryHash),
    );
    if (step === null && !recoveryValid) {
      return { error: await recordMfaFailure(tx, principal, row, now) };
    }
    const recoveryCodes = row.verifiedAt ? [] : createRecoveryCodes();
    await tx
      .update(factor)
      .set({
        enrollmentExpiresAt: null,
        enrollmentSessionId: null,
        failedAttempts: 0,
        failureWindowAt: null,
        lastUsedStep: step ?? row.lastUsedStep,
        lockedUntil: null,
        recoveryCodeHashes: row.verifiedAt
          ? row.recoveryCodeHashes.filter((hash) => hash !== recoveryHash)
          : recoveryCodes.map((code) => recoveryCodeHash(principal.userId, code)),
        verifiedAt: row.verifiedAt ?? now,
      })
      .where(eq(factor.userId, principal.userId));
    const authorization = await issueMfaGrant(tx, principal, now);
    await tx.insert(audit).values({
      action: `mfa.${row.verifiedAt ? input.method : "enroll.confirm"}`,
      actorId: principal.userId,
      id: randomUUID(),
      outcome: "success",
      sessionId: principal.sessionId,
    });
    return { ...authorization, recoveryCodes };
  });
  // Throw after committing so failed-attempt counters cannot roll back.
  if (result.error) {
    throw result.error;
  }
  return result;
}
