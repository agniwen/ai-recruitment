import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { acquireReportingLineWriteLock } from "@arc/ai-recruitment-copilot-backend/lib/server/db/reporting-line-write-lock";
import {
  member,
  memberReportingLine,
  organization,
  platformPreRegistration,
  user,
} from "@arc/db-schema/schema";
import {
  buildProspectiveManagerRelationships,
  hasPreRegistrationManagerCycle,
} from "./provisioning";
import { PRE_REGISTRATION_WORKSPACE_SLUG } from "./schema";
import type { PlatformPreRegistrationInput } from "./schema";

const directManagerPreRegistration = alias(
  platformPreRegistration,
  "pre_registration_direct_manager",
);
const directManagerUser = alias(user, "pre_registration_direct_manager_user");
const reportingLineManagerMember = alias(member, "pre_registration_reporting_line_manager");
const reportingLineMemberUser = alias(user, "pre_registration_reporting_line_member_user");
const reportingLineManagerUser = alias(user, "pre_registration_reporting_line_manager_user");

export interface PlatformPreRegistrationsQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: "displayName" | "email" | "createdAt";
  sortOrder: "asc" | "desc";
}

type MutationResult<T> = T | "cycle" | "duplicate" | "manager_not_found" | "not_found";
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;

async function lockWorkReportingLines(tx: DatabaseTransaction): Promise<void> {
  const [workspace] = await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, PRE_REGISTRATION_WORKSPACE_SLUG))
    .limit(1);
  if (!workspace) {
    throw new Error("Pre-registration workspace not found: work");
  }
  await acquireReportingLineWriteLock(tx, workspace.id);
}

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
    eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
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
        directManagerEmail: platformPreRegistration.directManagerEmail,
        directManagerName: sql<string | null>`coalesce(
          ${directManagerPreRegistration.displayName},
          ${directManagerUser.name}
        )`,
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
      .leftJoin(
        directManagerPreRegistration,
        and(
          eq(directManagerPreRegistration.workspaceSlug, platformPreRegistration.workspaceSlug),
          sql`lower(${directManagerPreRegistration.email}) = lower(${platformPreRegistration.directManagerEmail})`,
        ),
      )
      .leftJoin(
        directManagerUser,
        sql`lower(${directManagerUser.email}) = lower(${platformPreRegistration.directManagerEmail})`,
      )
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
  const [preRegistrations, registeredMembers] = await Promise.all([
    db
      .select({
        displayName: platformPreRegistration.displayName,
        email: platformPreRegistration.email,
      })
      .from(platformPreRegistration)
      .where(eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG)),
    db
      .select({ displayName: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(organization.slug, PRE_REGISTRATION_WORKSPACE_SLUG)),
  ]);
  const options = new Map<
    string,
    { displayName: string; email: string; source: "both" | "pre_registration" | "registered" }
  >();
  for (const entry of preRegistrations) {
    options.set(entry.email.toLowerCase(), { ...entry, source: "pre_registration" });
  }
  for (const entry of registeredMembers) {
    const key = entry.email.toLowerCase();
    const existing = options.get(key);
    options.set(key, {
      displayName: existing?.displayName ?? entry.displayName,
      email: entry.email,
      source: existing ? "both" : "registered",
    });
  }
  return [...options.values()].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName, "zh-CN"),
  );
}

async function managerExists(
  executor: DatabaseExecutor,
  managerEmail: string | null,
): Promise<boolean> {
  if (!managerEmail) {
    return true;
  }
  const normalizedEmail = managerEmail.toLowerCase();
  const [preRegistration, registeredMember] = await Promise.all([
    executor
      .select({ id: platformPreRegistration.id })
      .from(platformPreRegistration)
      .where(
        and(
          eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
          sql`lower(${platformPreRegistration.email}) = ${normalizedEmail}`,
        ),
      )
      .limit(1),
    executor
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(organization.slug, PRE_REGISTRATION_WORKSPACE_SLUG),
          sql`lower(${user.email}) = ${normalizedEmail}`,
        ),
      )
      .limit(1),
  ]);
  return Boolean(preRegistration[0] || registeredMember[0]);
}

async function emailExists(
  executor: DatabaseExecutor,
  email: string,
  excludedId?: string,
): Promise<boolean> {
  const [existing] = await executor
    .select({ id: platformPreRegistration.id })
    .from(platformPreRegistration)
    .where(
      and(
        eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
        sql`lower(${platformPreRegistration.email}) = ${email.trim().toLowerCase()}`,
        excludedId ? sql`${platformPreRegistration.id} <> ${excludedId}` : undefined,
      ),
    )
    .limit(1);
  return Boolean(existing);
}

async function registeredWorkMemberExists(
  executor: DatabaseExecutor,
  email: string,
): Promise<boolean> {
  const [registeredMember] = await executor
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(organization.slug, PRE_REGISTRATION_WORKSPACE_SLUG),
        sql`lower(${user.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);
  return Boolean(registeredMember);
}

async function createsCycle(
  executor: DatabaseExecutor,
  id: string,
  previousEmail: string | null,
  email: string,
  directManagerEmail: string | null,
): Promise<boolean> {
  const [rows, memberRelationships] = await Promise.all([
    executor
      .select({
        directManagerEmail: platformPreRegistration.directManagerEmail,
        email: platformPreRegistration.email,
        id: platformPreRegistration.id,
      })
      .from(platformPreRegistration)
      .where(eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG)),
    executor
      .select({
        directManagerEmail: reportingLineManagerUser.email,
        email: reportingLineMemberUser.email,
      })
      .from(memberReportingLine)
      .innerJoin(
        member,
        and(
          eq(member.organizationId, memberReportingLine.organizationId),
          eq(member.id, memberReportingLine.memberId),
        ),
      )
      .innerJoin(reportingLineMemberUser, eq(reportingLineMemberUser.id, member.userId))
      .innerJoin(
        reportingLineManagerMember,
        and(
          eq(reportingLineManagerMember.organizationId, memberReportingLine.organizationId),
          eq(reportingLineManagerMember.id, memberReportingLine.directManagerId),
        ),
      )
      .innerJoin(
        reportingLineManagerUser,
        eq(reportingLineManagerUser.id, reportingLineManagerMember.userId),
      )
      .innerJoin(organization, eq(organization.id, memberReportingLine.organizationId))
      .where(eq(organization.slug, PRE_REGISTRATION_WORKSPACE_SLUG)),
  ]);
  const nextRows = buildProspectiveManagerRelationships({
    current: { directManagerEmail, email, id },
    memberRelationships,
    preRegistrations: rows,
    previousEmail,
  });
  return hasPreRegistrationManagerCycle(nextRows);
}

function normalizedInput(input: PlatformPreRegistrationInput) {
  return {
    ...input,
    directManagerEmail: input.directManagerEmail?.toLowerCase() ?? null,
    email: input.email.toLowerCase(),
  };
}

export function createPlatformPreRegistration(
  input: PlatformPreRegistrationInput,
): Promise<MutationResult<typeof platformPreRegistration.$inferSelect>> {
  return db.transaction(async (tx) => {
    await lockWorkReportingLines(tx);
    if (await emailExists(tx, input.email)) {
      return "duplicate";
    }
    if (!(await managerExists(tx, input.directManagerEmail))) {
      return "manager_not_found";
    }
    const id = crypto.randomUUID();
    if (await createsCycle(tx, id, null, input.email, input.directManagerEmail)) {
      return "cycle";
    }
    const [created] = await tx
      .insert(platformPreRegistration)
      .values({
        ...normalizedInput(input),
        id,
        workspaceSlug: PRE_REGISTRATION_WORKSPACE_SLUG,
      })
      .returning();
    return created;
  });
}

export function updatePlatformPreRegistration(
  id: string,
  input: PlatformPreRegistrationInput,
): Promise<MutationResult<typeof platformPreRegistration.$inferSelect>> {
  return db.transaction(async (tx) => {
    await lockWorkReportingLines(tx);
    const [existing] = await tx
      .select({ email: platformPreRegistration.email, id: platformPreRegistration.id })
      .from(platformPreRegistration)
      .where(
        and(
          eq(platformPreRegistration.id, id),
          eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
        ),
      )
      .limit(1);
    if (!existing) {
      return "not_found";
    }
    if (await emailExists(tx, input.email, id)) {
      return "duplicate";
    }
    if (!(await managerExists(tx, input.directManagerEmail))) {
      return "manager_not_found";
    }
    const emailChanged = existing.email.toLowerCase() !== input.email.toLowerCase();
    const preservePreviousIdentity =
      emailChanged && (await registeredWorkMemberExists(tx, existing.email));
    const previousEmailToReplace = preservePreviousIdentity ? null : existing.email;
    if (await createsCycle(tx, id, previousEmailToReplace, input.email, input.directManagerEmail)) {
      return "cycle";
    }
    const changed = await tx
      .update(platformPreRegistration)
      .set({ ...normalizedInput(input), updatedAt: new Date() })
      .where(
        and(
          eq(platformPreRegistration.id, id),
          eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
        ),
      )
      .returning();
    if (emailChanged && !preservePreviousIdentity) {
      await tx
        .update(platformPreRegistration)
        .set({ directManagerEmail: input.email.toLowerCase(), updatedAt: new Date() })
        .where(
          and(
            eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
            sql`lower(${platformPreRegistration.directManagerEmail}) = ${existing.email.toLowerCase()}`,
          ),
        );
    }
    return changed[0] ?? "not_found";
  });
}

export function deletePlatformPreRegistration(id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockWorkReportingLines(tx);
    const [existing] = await tx
      .select({ email: platformPreRegistration.email })
      .from(platformPreRegistration)
      .where(
        and(
          eq(platformPreRegistration.id, id),
          eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
        ),
      )
      .limit(1);
    if (!existing) {
      return false;
    }
    const [registeredMember] = await tx
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(organization.slug, PRE_REGISTRATION_WORKSPACE_SLUG),
          sql`lower(${user.email}) = ${existing.email.toLowerCase()}`,
        ),
      )
      .limit(1);
    await tx
      .delete(platformPreRegistration)
      .where(
        and(
          eq(platformPreRegistration.id, id),
          eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
        ),
      );
    if (!registeredMember) {
      await tx
        .update(platformPreRegistration)
        .set({ directManagerEmail: null, updatedAt: new Date() })
        .where(
          and(
            eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
            sql`lower(${platformPreRegistration.directManagerEmail}) = ${existing.email.toLowerCase()}`,
          ),
        );
    }
    return true;
  });
}
