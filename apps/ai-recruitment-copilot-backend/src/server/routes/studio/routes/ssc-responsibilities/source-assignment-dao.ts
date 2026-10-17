import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  acquireSscProvisioningLock,
  syncSscMemberRole,
} from "@arc/ai-recruitment-copilot-backend/lib/server/ssc-provisioning";
import {
  member,
  organizationRole,
  resumeSource,
  sscResponsibility,
  user,
} from "@arc/db-schema/schema";
import { duplicateError } from "./dao";
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
  email: string;
  id: string;
  registered: boolean;
  sscName: string;
  telegram: string;
  workspaceRole: string;
  workspaceRoleName: string;
}

interface CandidateEntry {
  candidate: SscAssignmentCandidate;
  userId?: string;
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
      email: sscResponsibility.email,
      id: sscResponsibility.id,
      resumeSourceId: sscResponsibility.resumeSourceId,
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

function candidateContext(data: CandidateData, resumeSourceId: string) {
  const usersByEmail = new Map<string, CandidateData["users"]>();
  const intendedRoles = new Map<string, Set<string>>();
  const assignedEmails = new Set<string>();
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
    if (entry.resumeSourceId === resumeSourceId) {
      assignedEmails.add(email);
    }
  }
  return {
    assignedEmails,
    intendedRoles,
    roleNames: new Map(data.roles.map((role) => [role.role, role.name])),
    usersByEmail,
  };
}

type CandidateContext = ReturnType<typeof candidateContext>;

function compatibleIntent(context: CandidateContext, email: string, role: string) {
  const roles = context.intendedRoles.get(email);
  return !roles || roles.size === 0 || (roles.size === 1 && roles.has(role));
}

function memberCandidate(
  row: CandidateData["members"][number],
  context: CandidateContext,
): CandidateEntry | null {
  const contact = contactSchema.safeParse({
    email: row.email,
    sscName: row.name,
    telegram: row.telegram ?? "",
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
  return {
    candidate: {
      ...contact.data,
      assigned: context.assignedEmails.has(contact.data.email),
      id: `member:${row.id}`,
      registered: true,
      workspaceRoleName,
    },
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
  return {
    candidate: {
      ...contact.data,
      assigned: context.assignedEmails.has(contact.data.email),
      id: `responsibility:${row.id}`,
      registered: false,
      workspaceRoleName,
    },
  };
}

function buildCandidates(data: CandidateData, resumeSourceId: string) {
  const context = candidateContext(data, resumeSourceId);
  const byEmail = new Map<string, CandidateEntry>();
  for (const row of data.members) {
    const entry = memberCandidate(row, context);
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

export async function listSscAssignmentCandidates(organizationId: string, resumeSourceId: string) {
  if (!(await loadSource(db, organizationId, resumeSourceId, false))) {
    return "invalid_source" as const;
  }
  const candidates = buildCandidates(
    await loadCandidateData(db, organizationId, false),
    resumeSourceId,
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
      const catalog = buildCandidates(await loadCandidateData(tx, organizationId, true), source.id);
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
        selected.map(({ candidate }) => ({
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
