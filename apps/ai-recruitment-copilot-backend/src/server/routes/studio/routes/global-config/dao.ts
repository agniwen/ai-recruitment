import { eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { globalConfig, resumeProtectionConfigChange, user } from "@arc/db-schema/schema";
import type { GlobalConfigInput, GlobalConfigRecord } from "@arc/shared/global-config";

function serialize(row: typeof globalConfig.$inferSelect): GlobalConfigRecord {
  return {
    closingInstructions: row.closingInstructions,
    companyContext: row.companyContext,
    companyName: row.companyName,
    jobCodePrefix: row.jobCodePrefix,
    openingInstructions: row.openingInstructions,
    resumeProtectionDays: row.resumeProtectionDays,
    resumeProtectionUpdatedAt: row.resumeProtectionUpdatedAt?.toISOString() ?? null,
    resumeProtectionUpdatedBy: row.resumeProtectionUpdatedBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

// 按 organizationId 读取配置；不存在时懒创建一条空记录。
// Read config scoped to organizationId; lazily inserts an empty row when absent.
export async function getGlobalConfig(orgId: string): Promise<GlobalConfigRecord> {
  const [row] = await db
    .select()
    .from(globalConfig)
    .where(eq(globalConfig.organizationId, orgId))
    .limit(1);

  if (row) {
    const [editor] = row.resumeProtectionUpdatedBy
      ? await db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, row.resumeProtectionUpdatedBy))
          .limit(1)
      : [];
    return { ...serialize(row), resumeProtectionUpdatedByName: editor?.name ?? null };
  }

  // Lazy-create a blank config row for workspaces that have none yet (new
  // self-serve orgs or orgs created before this column was backfilled).
  const fresh = {
    closingInstructions: "",
    companyContext: "",
    companyName: "",
    id: `gc_${crypto.randomUUID()}`,
    jobCodePrefix: "AUR",
    openingInstructions: "",
    organizationId: orgId,
    resumeProtectionDays: 15,
    resumeProtectionUpdatedAt: null,
    resumeProtectionUpdatedBy: null,
    updatedAt: new Date(),
    updatedBy: null as string | null,
  };
  await db.insert(globalConfig).values(fresh);
  return serialize({ ...fresh });
}

// 按 organizationId 更新配置；不存在时懒创建再更新。
// Update config scoped to organizationId; lazily inserts if the row is absent.
export async function upsertGlobalConfig(
  input: GlobalConfigInput,
  userId: string | null,
  orgId: string,
): Promise<GlobalConfigRecord> {
  const now = new Date();

  const [existing] = await db
    .select({ id: globalConfig.id })
    .from(globalConfig)
    .where(eq(globalConfig.organizationId, orgId))
    .limit(1);

  if (!existing) {
    const fresh = {
      closingInstructions: input.closingInstructions,
      companyContext: input.companyContext,
      companyName: input.companyName,
      id: `gc_${crypto.randomUUID()}`,
      jobCodePrefix: input.jobCodePrefix,
      openingInstructions: input.openingInstructions,
      organizationId: orgId,
      resumeProtectionDays: 15,
      resumeProtectionUpdatedAt: null,
      resumeProtectionUpdatedBy: null,
      updatedAt: now,
      updatedBy: userId,
    };
    await db.insert(globalConfig).values(fresh);
    return serialize({ ...fresh });
  }

  await db
    .update(globalConfig)
    .set({
      closingInstructions: input.closingInstructions,
      companyContext: input.companyContext,
      companyName: input.companyName,
      jobCodePrefix: input.jobCodePrefix,
      openingInstructions: input.openingInstructions,
      updatedAt: now,
      updatedBy: userId,
    })
    .where(eq(globalConfig.organizationId, orgId));

  const [updated] = await db
    .select()
    .from(globalConfig)
    .where(eq(globalConfig.organizationId, orgId))
    .limit(1);
  return serialize(updated);
}

export async function saveResumeProtectionDays(orgId: string, userId: string, days: number) {
  await getGlobalConfig(orgId);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(globalConfig)
      .where(eq(globalConfig.organizationId, orgId))
      .for("update");
    if (current.resumeProtectionDays === days) {
      return serialize(current);
    }
    const now = new Date();
    const [updated] = await tx
      .update(globalConfig)
      .set({
        resumeProtectionDays: days,
        resumeProtectionUpdatedAt: now,
        resumeProtectionUpdatedBy: userId,
      })
      .where(eq(globalConfig.id, current.id))
      .returning();
    await tx.insert(resumeProtectionConfigChange).values({
      changedAt: now,
      changedBy: userId,
      days,
      id: crypto.randomUUID(),
      organizationId: orgId,
      previousDays: current.resumeProtectionDays,
    });
    return serialize(updated);
  });
}
