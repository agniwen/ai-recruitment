import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, organizationRole, sscResponsibility, user } from "@arc/db-schema/schema";
import { decideSscMemberRole } from "./ssc-provisioning-policy";
import type { SscMemberSyncStatus } from "./ssc-provisioning-policy";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | DatabaseTransaction;

export async function acquireSscProvisioningLock(tx: Executor, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ssc-responsibilities:${organizationId}`}, 0))`,
  );
}

export async function syncSscMemberRole(
  tx: Executor,
  {
    allowExistingRoleUpdate,
    email,
    expectedUserId,
    organizationId,
    workspaceRole,
  }: {
    allowExistingRoleUpdate: boolean;
    email: string;
    expectedUserId?: string;
    organizationId: string;
    workspaceRole: string;
  },
): Promise<{ status: SscMemberSyncStatus }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { status: "empty_email" };
  }
  await acquireSscProvisioningLock(tx, organizationId);
  const [role] = await tx
    .select({ id: organizationRole.id })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.role, workspaceRole),
        eq(organizationRole.isSsc, true),
        eq(organizationRole.isOdc, false),
      ),
    )
    .limit(1)
    .for("share");
  if (!role) {
    return { status: "role_conflict" };
  }
  const intents = await tx
    .select({ role: sscResponsibility.workspaceRole })
    .from(sscResponsibility)
    .where(
      and(
        eq(sscResponsibility.organizationId, organizationId),
        sql`lower(btrim(${sscResponsibility.email})) = ${normalizedEmail}`,
        isNotNull(sscResponsibility.workspaceRole),
      ),
    );
  if (intents.length === 0 || intents.some((intent) => intent.role !== workspaceRole)) {
    return { status: "role_conflict" };
  }
  const users = await tx
    .select({ banned: user.banned, id: user.id })
    .from(user)
    .where(sql`lower(btrim(${user.email})) = ${normalizedEmail}`)
    .limit(2)
    .for("share");
  if (users.length !== 1) {
    return { status: users.length === 0 ? "unregistered" : "ambiguous_email" };
  }
  const [matched] = users;
  if (expectedUserId && matched.id !== expectedUserId) {
    return { status: "role_conflict" };
  }
  const [existing] = await tx
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, matched.id)))
    .limit(1)
    .for("update");
  const status = decideSscMemberRole({
    allowExistingRoleUpdate,
    banned: matched.banned === true,
    desiredRole: workspaceRole,
    existingRole: existing?.role ?? null,
  });
  if (status === "created") {
    const inserted = await tx
      .insert(member)
      .values({
        id: `mem_${randomUUID()}`,
        organizationId,
        role: workspaceRole,
        userId: matched.id,
      })
      .onConflictDoNothing({ target: [member.userId, member.organizationId] })
      .returning({ id: member.id });
    return { status: inserted.length === 1 ? "created" : "role_conflict" };
  }
  if (status === "updated" && existing) {
    await tx
      .update(member)
      .set({ role: workspaceRole })
      .where(and(eq(member.organizationId, organizationId), eq(member.id, existing.id)));
  }
  return { status };
}

export async function provisionSscUserOnSignIn({
  email,
  userId,
}: {
  email: string;
  userId: string;
}) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return;
  }
  const rows = await db
    .select({
      organizationId: sscResponsibility.organizationId,
      role: sscResponsibility.workspaceRole,
    })
    .from(sscResponsibility)
    .innerJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, sscResponsibility.organizationId),
        eq(organizationRole.role, sscResponsibility.workspaceRole),
        eq(organizationRole.isSsc, true),
      ),
    )
    .where(sql`lower(btrim(${sscResponsibility.email})) = ${normalizedEmail}`);
  const rolesByWorkspace = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.role) {
      const roles = rolesByWorkspace.get(row.organizationId) ?? new Set<string>();
      roles.add(row.role);
      rolesByWorkspace.set(row.organizationId, roles);
    }
  }
  for (const [organizationId, roles] of rolesByWorkspace) {
    const [workspaceRole] = roles;
    if (roles.size === 1 && workspaceRole) {
      await db.transaction(async (tx) => {
        await syncSscMemberRole(tx, {
          allowExistingRoleUpdate: false,
          email: normalizedEmail,
          expectedUserId: userId,
          organizationId,
          workspaceRole,
        });
      });
    }
  }
}
