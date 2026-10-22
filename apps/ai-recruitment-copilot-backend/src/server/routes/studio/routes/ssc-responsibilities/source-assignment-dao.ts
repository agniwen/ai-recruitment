import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  acquireSscProvisioningLock,
  syncSscMemberRole,
} from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import {
  department,
  member,
  organizationRole,
  resumeSource,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { duplicateError } from "./dao";
import { resolveSscMemberTelegram } from "./member-telegram";
import { sscResponsibilityInputSchema } from "./schema";
import type { SscSourceAssignmentInput } from "./schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<typeof db, "select">;
const contactSchema = sscResponsibilityInputSchema.pick({
  email: true,
  sscName: true,
  telegram: true,
  workspaceRole: true,
});

export interface SscAssignmentCandidate {
  assigned: boolean;
  departmentId: string | null;
  email: string;
  id: string;
  registered: boolean;
  serviceUnit: string | null;
  sscName: string;
  telegram: string;
  workspaceRole: string;
  workspaceRoleName: string;
}

interface CandidateEntry {
  candidate: SscAssignmentCandidate;
  scope: JobScope;
  userId?: string;
}

interface JobScope {
  departmentId: string | null;
  serviceUnit: string | null;
}
type AssignmentScope = Partial<JobScope>;

function jobScope(input: AssignmentScope, fallback?: AssignmentScope): JobScope {
  return {
    departmentId:
      input.departmentId === undefined ? (fallback?.departmentId ?? null) : input.departmentId,
    serviceUnit:
      (input.serviceUnit === undefined ? fallback?.serviceUnit : input.serviceUnit)?.trim() || null,
  };
}

async function validDepartment(
  executor: Executor,
  organizationId: string,
  departmentId: string | null | undefined,
  lock: boolean,
) {
  if (!departmentId) {
    return true;
  }
  const query = executor
    .select({ id: department.id })
    .from(department)
    .where(and(eq(department.id, departmentId), eq(department.organizationId, organizationId)));
  const [row] = await (lock ? query.for("share") : query);
  return Boolean(row);
}

class StaleSscCandidateError extends Error {
  override name = "StaleSscCandidateError";
}

async function loadSource(executor: Executor, organizationId: string, id: string, lock: boolean) {
  const query = executor
    .select({ id: resumeSource.id, name: resumeSource.name })
    .from(resumeSource)
    .where(and(eq(resumeSource.organizationId, organizationId), eq(resumeSource.id, id)));
  const [source] = await (lock ? query.for("share") : query);
  return source;
}

async function loadCandidateData(executor: Executor, organizationId: string, lock: boolean) {
  const roleQuery = executor
    .select({ name: organizationRole.name, role: organizationRole.role })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.isSsc, true),
        eq(organizationRole.isOdc, false),
        notInArray(organizationRole.role, ["owner", "admin", "member", "noAccess"]),
      ),
    );
  const roles = await (lock ? roleQuery.for("share") : roleQuery);
  const entryQuery = executor
    .select({
      departmentId: sscResponsibility.departmentId,
      email: sscResponsibility.email,
      id: sscResponsibility.id,
      resumeSourceId: sscResponsibility.resumeSourceId,
      serviceUnit: sscResponsibility.serviceUnit,
      sscName: sscResponsibility.sscName,
      telegram: sscResponsibility.telegram,
      workspaceRole: sscResponsibility.workspaceRole,
    })
    .from(sscResponsibility)
    .where(eq(sscResponsibility.organizationId, organizationId))
    .orderBy(asc(sscResponsibility.createdAt), asc(sscResponsibility.id));
  const entries = await (lock ? entryQuery.for("share") : entryQuery);
  const memberQuery = executor
    .select({
      email: user.email,
      id: member.id,
      name: user.name,
      role: member.role,
      telegram: user.telegram,
      userId: user.id,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        inArray(
          member.role,
          roles.map((role) => role.role),
        ),
        eq(user.banned, false),
      ),
    )
    .orderBy(asc(member.id));
  const members = await (lock ? memberQuery.for("share") : memberQuery);
  const emails = [
    ...new Set(
      [...entries, ...members].map((entry) => entry.email.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  const userQuery = executor
    .select({ banned: user.banned, email: user.email, id: user.id })
    .from(user)
    .where(inArray(sql<string>`lower(btrim(${user.email}))`, emails))
    .orderBy(asc(user.id));
  const users = await (lock ? userQuery.for("share") : userQuery);
  return { entries, members, roles, users };
}

type CandidateData = Awaited<ReturnType<typeof loadCandidateData>>;

function candidateContext(data: CandidateData, resumeSourceId: string, scope: AssignmentScope) {
  const usersByEmail = new Map<string, CandidateData["users"]>();
  const intendedRoles = new Map<string, Set<string>>();
  for (const row of data.users) {
    const email = row.email.trim().toLowerCase();
    usersByEmail.set(email, [...(usersByEmail.get(email) ?? []), row]);
  }
  for (const entry of data.entries) {
    const email = entry.email.trim().toLowerCase();
    const roles = intendedRoles.get(email) ?? new Set<string>();
    if (entry.workspaceRole) {
      roles.add(entry.workspaceRole);
    }
    intendedRoles.set(email, roles);
  }
  return {
    entries: data.entries,
    intendedRoles,
    resumeSourceId,
    roleNames: new Map(data.roles.map((role) => [role.role, role.name])),
    scope,
    usersByEmail,
  };
}

type CandidateContext = ReturnType<typeof candidateContext>;

function alreadyAssigned(context: CandidateContext, email: string, scope: JobScope) {
  return context.entries.some(
    (entry) =>
      entry.resumeSourceId === context.resumeSourceId &&
      entry.email.trim().toLowerCase() === email &&
      (entry.departmentId ?? null) === scope.departmentId &&
      (entry.serviceUnit?.trim().toLowerCase() || null) ===
        (scope.serviceUnit?.toLowerCase() ?? null),
  );
}

function compatibleIntent(context: CandidateContext, email: string, role: string) {
  const roles = context.intendedRoles.get(email);
  return !roles || roles.size === 0 || (roles.size === 1 && roles.has(role));
}

function memberCandidate(
  row: CandidateData["members"][number],
  context: CandidateContext,
  entries: CandidateData["entries"],
): CandidateEntry | null {
  const contact = contactSchema.safeParse({
    email: row.email,
    sscName: row.name,
    telegram: row.telegram?.trim()
      ? row.telegram
      : (resolveSscMemberTelegram(entries, { email: row.email, workspaceRole: row.role }) ?? ""),
    workspaceRole: row.role,
  });
  if (!contact.success || !contact.data.email) {
    return null;
  }
  const matches = context.usersByEmail.get(contact.data.email) ?? [];
  if (matches.length !== 1 || matches[0].id !== row.userId || matches[0].banned) {
    return null;
  }
  if (!compatibleIntent(context, contact.data.email, row.role)) {
    return null;
  }
  const workspaceRoleName = context.roleNames.get(row.role);
  if (workspaceRoleName === undefined) {
    return null;
  }
  const scope = jobScope(context.scope);
  return {
    candidate: {
      ...contact.data,
      ...scope,
      assigned: alreadyAssigned(context, contact.data.email, scope),
      id: `member:${row.id}`,
      registered: true,
      workspaceRoleName,
    },
    scope,
    userId: row.userId,
  };
}

function preentryCandidate(
  row: CandidateData["entries"][number],
  context: CandidateContext,
): CandidateEntry | null {
  const contact = contactSchema.safeParse(row);
  if (!contact.success || !contact.data.email) {
    return null;
  }
  if (context.usersByEmail.has(contact.data.email)) {
    return null;
  }
  if (!compatibleIntent(context, contact.data.email, contact.data.workspaceRole)) {
    return null;
  }
  const workspaceRoleName = context.roleNames.get(contact.data.workspaceRole);
  if (workspaceRoleName === undefined) {
    return null;
  }
  const scope = jobScope(context.scope, row);
  return {
    candidate: {
      ...contact.data,
      ...scope,
      assigned: alreadyAssigned(context, contact.data.email, scope),
      id: `responsibility:${row.id}`,
      registered: false,
      workspaceRoleName,
    },
    scope,
  };
}

function buildCandidates(data: CandidateData, resumeSourceId: string, scope: AssignmentScope) {
  const context = candidateContext(data, resumeSourceId, scope);
  const byEmail = new Map<string, CandidateEntry>();
  for (const row of data.members) {
    const entry = memberCandidate(row, context, data.entries);
    if (entry) {
      byEmail.set(entry.candidate.email, entry);
    }
  }
  for (const row of data.entries) {
    const entry = preentryCandidate(row, context);
    if (entry && !byEmail.has(entry.candidate.email)) {
      byEmail.set(entry.candidate.email, entry);
    }
  }
  return [...byEmail.values()].toSorted(
    (left, right) =>
      left.candidate.sscName.localeCompare(right.candidate.sscName, "zh-CN") ||
      left.candidate.email.localeCompare(right.candidate.email) ||
      left.candidate.id.localeCompare(right.candidate.id),
  );
}

export async function listSscAssignmentCandidates(
  organizationId: string,
  input: AssignmentScope & { resumeSourceId: string },
) {
  if (!(await loadSource(db, organizationId, input.resumeSourceId, false))) {
    return "invalid_source" as const;
  }
  if (!(await validDepartment(db, organizationId, input.departmentId, false))) {
    return "invalid_department" as const;
  }
  const candidates = buildCandidates(
    await loadCandidateData(db, organizationId, false),
    input.resumeSourceId,
    input,
  );
  return { candidates: candidates.map((entry) => entry.candidate) };
}

async function synchronizeCandidateRoles(
  tx: Transaction,
  organizationId: string,
  candidates: CandidateEntry[],
) {
  for (const entry of candidates) {
    const result = await syncSscMemberRole(tx, {
      allowExistingRoleUpdate: false,
      email: entry.candidate.email,
      expectedUserId: entry.userId,
      organizationId,
      workspaceRole: entry.candidate.workspaceRole,
    });
    if (!["unchanged", "unregistered", "created"].includes(result.status)) {
      throw new StaleSscCandidateError();
    }
  }
}

export async function assignSscSourceCandidates(
  organizationId: string,
  input: SscSourceAssignmentInput,
) {
  if (new Set(input.candidateIds).size !== input.candidateIds.length) {
    return "duplicate" as const;
  }
  try {
    return await db.transaction(async (tx) => {
      await acquireSscProvisioningLock(tx, organizationId);
      const source = await loadSource(tx, organizationId, input.resumeSourceId, true);
      if (!source) {
        return "invalid_source" as const;
      }
      if (!(await validDepartment(tx, organizationId, input.departmentId, true))) {
        return "invalid_department" as const;
      }
      const catalog = buildCandidates(
        await loadCandidateData(tx, organizationId, true),
        source.id,
        input,
      );
      const byId = new Map(catalog.map((entry) => [entry.candidate.id, entry]));
      const selected: CandidateEntry[] = [];
      for (const id of input.candidateIds) {
        const entry = byId.get(id);
        if (!entry) {
          return "stale" as const;
        }
        if (entry.candidate.assigned) {
          return "duplicate" as const;
        }
        selected.push(entry);
      }
      await tx.insert(sscResponsibility).values(
        selected.map(({ candidate, scope }) => ({
          ...scope,
          centerName: source.name,
          demandOwner: "",
          email: candidate.email,
          id: randomUUID(),
          notes: "",
          organizationId,
          resumeSourceId: source.id,
          sscName: candidate.sscName,
          telegram: candidate.telegram,
          workspaceRole: candidate.workspaceRole,
        })),
      );
      await synchronizeCandidateRoles(tx, organizationId, selected);
      return { added: selected.length };
    });
  } catch (error) {
    if (error instanceof StaleSscCandidateError) {
      return "stale" as const;
    }
    if (duplicateError(error)) {
      return "duplicate" as const;
    }
    throw error;
  }
}
