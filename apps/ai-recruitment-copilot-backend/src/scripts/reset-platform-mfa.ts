import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  platformMfaFactor,
  platformMfaGrant,
  platformSecurityAudit,
  session,
  user,
} from "@arc/db-schema/schema";
import { loadStandaloneEnv } from "../standalone/env";

// Break-glass operation requires server access; deliberately no password-only web reset endpoint.
loadStandaloneEnv();
const userId = process.argv.find((arg) => arg.startsWith("--user-id="))?.slice("--user-id=".length);
const operator = process.argv
  .find((arg) => arg.startsWith("--operator="))
  ?.slice("--operator=".length);
if (!userId || !operator || !process.argv.includes("--apply")) {
  throw new Error(
    "Usage: security:reset-mfa --user-id=<id> --operator=<operator-id> --apply (revokes all target sessions)",
  );
}
const { db, closeDatabase } = await import("../lib/server/db");
try {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!target) {
      throw new Error("Unknown user");
    }
    await tx.delete(platformMfaGrant).where(eq(platformMfaGrant.userId, userId));
    await tx.delete(platformMfaFactor).where(eq(platformMfaFactor.userId, userId));
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.insert(platformSecurityAudit).values({
      action: "mfa.operator-reset",
      actorId: operator,
      id: randomUUID(),
      outcome: "success",
      targetId: userId,
    });
  });
  console.log("MFA reset and all target sessions revoked. The user must sign in and enroll again.");
} catch {
  console.error("MFA reset failed; no credentials were logged.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
