import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { platformPreRegistration, user } from "@arc/db-schema/schema";
import { hasPreRegistrationManagerCycle } from "./provisioning";
import type { PlatformPreRegistrationInput } from "./schema";

const directManager = alias(platformPreRegistration, "pre_registration_direct_manager");

export interface PlatformPreRegistrationsQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: "displayName" | "email" | "createdAt";
  sortOrder: "asc" | "desc";
}

type MutationResult<T> = T | "cycle" | "duplicate" | "manager_not_found" | "not_found";

function orderBy(query: PlatformPreRegistrationsQuery) {
  if (query.sortBy === "email") {
    return query.sortOrder === "desc"
      ? desc(platformPreRegistration.email)
      : asc(platformPreRegistration.email);
  }
  if (query.sortBy === "createdAt") {
    return query.sortOrder === "desc"
      ? desc(platformPreRegistration.createdAt)
      : asc(platformPreRegistration.createdAt);
  }
  return query.sortOrder === "desc"
    ? desc(platformPreRegistration.displayName)
    : asc(platformPreRegistration.displayName);
}

export async function queryPaginatedPlatformPreRegistrations(query: PlatformPreRegistrationsQuery) {
  const search = query.search?.trim();
  const searchFilter = and(
    eq(platformPreRegistration.workspaceSlug, "work"),
    search
      ? or(
          ilike(platformPreRegistration.displayName, `%${search}%`),
          ilike(platformPreRegistration.email, `%${search}%`),
          ilike(platformPreRegistration.telegram, `%${search}%`),
          sql`exists (
            select 1
            from unnest(${platformPreRegistration.recruitingGroupNames}) as group_name(name)
            where group_name.name ilike ${`%${search}%`}
          )`,
        )
      : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        createdAt: platformPreRegistration.createdAt,
        directManagerId: platformPreRegistration.directManagerId,
        directManagerName: directManager.displayName,
        displayName: platformPreRegistration.displayName,
        email: platformPreRegistration.email,
        id: platformPreRegistration.id,
        recruitingGroupNames: platformPreRegistration.recruitingGroupNames,
        recruitingRole: platformPreRegistration.recruitingRole,
        registeredUserId: user.id,
        telegram: platformPreRegistration.telegram,
        updatedAt: platformPreRegistration.updatedAt,
        workspaceSlug: platformPreRegistration.workspaceSlug,
      })
      .from(platformPreRegistration)
      .leftJoin(directManager, eq(directManager.id, platformPreRegistration.directManagerId))
      .leftJoin(user, sql`lower(${user.email}) = lower(${platformPreRegistration.email})`)
      .where(searchFilter)
      .orderBy(orderBy(query))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(platformPreRegistration).where(searchFilter),
  ]);
  return {
    page: query.page,
    pageSize: query.pageSize,
    records: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function listPlatformPreRegistrationManagerOptions() {
  return await db
    .select({
      displayName: platformPreRegistration.displayName,
      email: platformPreRegistration.email,
      id: platformPreRegistration.id,
    })
    .from(platformPreRegistration)
    .where(eq(platformPreRegistration.workspaceSlug, "work"))
    .orderBy(asc(platformPreRegistration.displayName));
}

async function managerExists(managerId: string | null): Promise<boolean> {
  if (!managerId) {
    return true;
  }
  const [manager] = await db
    .select({ id: platformPreRegistration.id })
    .from(platformPreRegistration)
    .where(
      and(
        eq(platformPreRegistration.id, managerId),
        eq(platformPreRegistration.workspaceSlug, "work"),
      ),
    )
    .limit(1);
  return Boolean(manager);
}

async function emailExists(email: string, excludedId?: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: platformPreRegistration.id })
    .from(platformPreRegistration)
    .where(
      and(
        eq(platformPreRegistration.workspaceSlug, "work"),
        sql`lower(${platformPreRegistration.email}) = ${email.trim().toLowerCase()}`,
        excludedId ? sql`${platformPreRegistration.id} <> ${excludedId}` : undefined,
      ),
    )
    .limit(1);
  return Boolean(existing);
}

async function createsCycle(id: string, directManagerId: string | null): Promise<boolean> {
  const rows = await db
    .select({
      directManagerId: platformPreRegistration.directManagerId,
      id: platformPreRegistration.id,
    })
    .from(platformPreRegistration)
    .where(eq(platformPreRegistration.workspaceSlug, "work"));
  const nextRows = rows.filter((row) => row.id !== id);
  nextRows.push({ directManagerId, id });
  return hasPreRegistrationManagerCycle(nextRows);
}

export async function createPlatformPreRegistration(
  input: PlatformPreRegistrationInput,
): Promise<MutationResult<typeof platformPreRegistration.$inferSelect>> {
  if (await emailExists(input.email)) {
    return "duplicate";
  }
  if (!(await managerExists(input.directManagerId))) {
    return "manager_not_found";
  }
  const id = crypto.randomUUID();
  if (await createsCycle(id, input.directManagerId)) {
    return "cycle";
  }
  const [created] = await db
    .insert(platformPreRegistration)
    .values({ ...input, id, workspaceSlug: "work" })
    .returning();
  return created;
}

export async function updatePlatformPreRegistration(
  id: string,
  input: PlatformPreRegistrationInput,
): Promise<MutationResult<typeof platformPreRegistration.$inferSelect>> {
  const [existing] = await db
    .select({ id: platformPreRegistration.id })
    .from(platformPreRegistration)
    .where(eq(platformPreRegistration.id, id))
    .limit(1);
  if (!existing) {
    return "not_found";
  }
  if (await emailExists(input.email, id)) {
    return "duplicate";
  }
  if (!(await managerExists(input.directManagerId))) {
    return "manager_not_found";
  }
  if (await createsCycle(id, input.directManagerId)) {
    return "cycle";
  }
  const [updated] = await db
    .update(platformPreRegistration)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(platformPreRegistration.id, id))
    .returning();
  return updated ?? "not_found";
}

export async function deletePlatformPreRegistration(id: string): Promise<boolean> {
  const deleted = await db
    .delete(platformPreRegistration)
    .where(eq(platformPreRegistration.id, id))
    .returning({ id: platformPreRegistration.id });
  return deleted.length > 0;
}
