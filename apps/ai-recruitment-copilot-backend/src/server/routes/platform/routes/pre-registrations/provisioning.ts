import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { acquireReportingLineWriteLock } from "@arc/ai-recruitment-copilot-backend/lib/server/db/reporting-line-write-lock";
import {
  member,
  memberReportingLine,
  organization,
  platformPreRegistration,
  recruitingGroup,
  recruitingGroupMember,
  user,
} from "@arc/db-schema/schema";
import { PRE_REGISTRATION_WORKSPACE_SLUG } from "./schema";
import type { PreRegistrationRecruitingRole } from "./schema";

export interface PreRegistrationProvisioningRecord {
  directManagerEmail: string | null;
  displayName: string;
  email: string;
  id: string;
  recruitingGroupNames: string[];
  recruitingRole: PreRegistrationRecruitingRole;
  telegram: string;
  workspaceSlug: string;
}

export interface PreRegistrationProvisioningDependencies {
  applyRegistration: (
    registration: PreRegistrationProvisioningRecord,
    userId: string,
  ) => Promise<void>;
  findRegistrationByEmail: (
    normalizedEmail: string,
  ) => Promise<PreRegistrationProvisioningRecord | null>;
  reconcileWorkspaceReportingLines: (workspaceSlug: string) => Promise<void>;
}

export function buildPreRegistrationProfileUpdate(
  registration: Pick<PreRegistrationProvisioningRecord, "displayName" | "telegram">,
) {
  return {
    name: registration.displayName,
    telegram: registration.telegram,
  };
}

export function buildRegisteredReportingLines(
  registrations: readonly {
    directManagerEmail: string | null;
    email: string;
  }[],
  workspaceMembers: readonly { email: string; memberId: string }[],
  organizationId: string,
) {
  const memberIdByEmail = new Map(
    workspaceMembers.map((row) => [row.email.trim().toLowerCase(), row.memberId]),
  );
  const registeredPreEntries = registrations.flatMap((registration) => {
    const memberId = memberIdByEmail.get(registration.email.trim().toLowerCase());
    return memberId ? [{ ...registration, memberId }] : [];
  });
  return {
    managedMemberIds: registeredPreEntries.map((row) => row.memberId),
    reportingLines: registeredPreEntries.flatMap((row) => {
      const directManagerMemberId = row.directManagerEmail
        ? memberIdByEmail.get(row.directManagerEmail.trim().toLowerCase())
        : null;
      return directManagerMemberId
        ? [
            {
              directManagerId: directManagerMemberId,
              memberId: row.memberId,
              organizationId,
            },
          ]
        : [];
    }),
  };
}

export function hasPreRegistrationManagerCycle(
  rows: readonly { directManagerEmail: string | null; email: string }[],
): boolean {
  const managerByEmail = new Map(
    rows.map((row) => [
      row.email.trim().toLowerCase(),
      row.directManagerEmail?.trim().toLowerCase(),
    ]),
  );
  for (const row of rows) {
    const visited = new Set<string>();
    let currentEmail: string | null | undefined = row.email.trim().toLowerCase();
    while (currentEmail) {
      if (visited.has(currentEmail)) {
        return true;
      }
      visited.add(currentEmail);
      currentEmail = managerByEmail.get(currentEmail);
    }
  }
  return false;
}

export function buildReconciledReportingLines(
  current: readonly { directManagerId: string; memberId: string }[],
  managedMemberIds: readonly string[],
  replacements: readonly { directManagerId: string; memberId: string }[],
) {
  const managedIds = new Set(managedMemberIds);
  return [...current.filter((row) => !managedIds.has(row.memberId)), ...replacements];
}

export function hasMemberReportingLineCycle(
  rows: readonly { directManagerId: string; memberId: string }[],
): boolean {
  const managerByMemberId = new Map(rows.map((row) => [row.memberId, row.directManagerId]));
  for (const row of rows) {
    const visited = new Set<string>();
    let currentMemberId: string | undefined = row.memberId;
    while (currentMemberId) {
      if (visited.has(currentMemberId)) {
        return true;
      }
      visited.add(currentMemberId);
      currentMemberId = managerByMemberId.get(currentMemberId);
    }
  }
  return false;
}

export function buildProspectiveManagerRelationships({
  current,
  memberRelationships,
  preRegistrations,
  previousEmail,
}: {
  current: { directManagerEmail: string | null; email: string; id: string };
  memberRelationships: readonly { directManagerEmail: string; email: string }[];
  preRegistrations: readonly {
    directManagerEmail: string | null;
    email: string;
    id: string;
  }[];
  previousEmail: string | null;
}) {
  const nextPreRegistrations = preRegistrations
    .filter((row) => row.id !== current.id)
    .map((row) => ({
      directManagerEmail:
        previousEmail && row.directManagerEmail?.toLowerCase() === previousEmail.toLowerCase()
          ? current.email
          : row.directManagerEmail,
      email: row.email,
    }));
  nextPreRegistrations.push({
    directManagerEmail: current.directManagerEmail,
    email: current.email,
  });
  const preRegistrationEmails = new Set(nextPreRegistrations.map((row) => row.email.toLowerCase()));
  return [
    ...nextPreRegistrations,
    ...memberRelationships.filter((row) => !preRegistrationEmails.has(row.email.toLowerCase())),
  ];
}

async function findRegistrationByEmail(
  normalizedEmail: string,
): Promise<PreRegistrationProvisioningRecord | null> {
  const [registration] = await db
    .select({
      directManagerEmail: platformPreRegistration.directManagerEmail,
      displayName: platformPreRegistration.displayName,
      email: platformPreRegistration.email,
      id: platformPreRegistration.id,
      recruitingGroupNames: platformPreRegistration.recruitingGroupNames,
      recruitingRole: platformPreRegistration.recruitingRole,
      telegram: platformPreRegistration.telegram,
      workspaceSlug: platformPreRegistration.workspaceSlug,
    })
    .from(platformPreRegistration)
    .where(
      and(
        eq(platformPreRegistration.workspaceSlug, PRE_REGISTRATION_WORKSPACE_SLUG),
        sql`lower(${platformPreRegistration.email}) = ${normalizedEmail}`,
      ),
    )
    .limit(1);
  return registration
    ? {
        ...registration,
        recruitingRole: registration.recruitingRole as PreRegistrationRecruitingRole,
      }
    : null;
}

async function applyRegistration(
  registration: PreRegistrationProvisioningRecord,
  userId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, registration.workspaceSlug))
    .limit(1);
  if (!workspace) {
    throw new Error(`Pre-registration workspace not found: ${registration.workspaceSlug}`);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set(buildPreRegistrationProfileUpdate(registration))
      .where(eq(user.id, userId));
    await tx
      .insert(member)
      .values({
        id: `mem_${crypto.randomUUID()}`,
        organizationId: workspace.id,
        role: "member",
        userId,
      })
      .onConflictDoNothing({ target: [member.userId, member.organizationId] });

    if (registration.recruitingGroupNames.length === 0) {
      return;
    }
    await tx
      .insert(recruitingGroup)
      .values(
        registration.recruitingGroupNames.map((name) => ({
          createdBy: userId,
          id: crypto.randomUUID(),
          name,
          organizationId: workspace.id,
        })),
      )
      .onConflictDoNothing({ target: [recruitingGroup.organizationId, recruitingGroup.name] });
    const groups = await tx
      .select({ id: recruitingGroup.id })
      .from(recruitingGroup)
      .where(
        and(
          eq(recruitingGroup.organizationId, workspace.id),
          inArray(recruitingGroup.name, registration.recruitingGroupNames),
        ),
      );
    await tx
      .insert(recruitingGroupMember)
      .values(
        groups.map((group) => ({
          createdBy: userId,
          groupId: group.id,
          id: crypto.randomUUID(),
          organizationId: workspace.id,
          role: registration.recruitingRole,
          userId,
        })),
      )
      .onConflictDoUpdate({
        set: { role: registration.recruitingRole, updatedAt: new Date() },
        target: [
          recruitingGroupMember.organizationId,
          recruitingGroupMember.groupId,
          recruitingGroupMember.userId,
        ],
      });
  });
}

async function reconcileWorkspaceReportingLines(workspaceSlug: string): Promise<void> {
  const [workspace] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, workspaceSlug))
    .limit(1);
  if (!workspace) {
    return;
  }

  await db.transaction(async (tx) => {
    await acquireReportingLineWriteLock(tx, workspace.id);
    const [registrations, workspaceMembers, currentReportingLines] = await Promise.all([
      tx
        .select({
          directManagerEmail: platformPreRegistration.directManagerEmail,
          email: platformPreRegistration.email,
        })
        .from(platformPreRegistration)
        .where(eq(platformPreRegistration.workspaceSlug, workspaceSlug)),
      tx
        .select({ email: user.email, memberId: member.id })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, workspace.id)),
      tx
        .select({
          directManagerId: memberReportingLine.directManagerId,
          memberId: memberReportingLine.memberId,
        })
        .from(memberReportingLine)
        .where(eq(memberReportingLine.organizationId, workspace.id)),
    ]);
    const { managedMemberIds, reportingLines } = buildRegisteredReportingLines(
      registrations,
      workspaceMembers,
      workspace.id,
    );
    const reconciledReportingLines = buildReconciledReportingLines(
      currentReportingLines,
      managedMemberIds,
      reportingLines,
    );
    if (hasMemberReportingLineCycle(reconciledReportingLines)) {
      throw new Error("Pre-registration reporting lines would create a cycle.");
    }
    if (managedMemberIds.length > 0) {
      await tx
        .delete(memberReportingLine)
        .where(
          and(
            eq(memberReportingLine.organizationId, workspace.id),
            inArray(memberReportingLine.memberId, managedMemberIds),
          ),
        );
    }
    if (reportingLines.length > 0) {
      await tx.insert(memberReportingLine).values(reportingLines);
    }
  });
}

const defaultDependencies: PreRegistrationProvisioningDependencies = {
  applyRegistration,
  findRegistrationByEmail,
  reconcileWorkspaceReportingLines,
};

export async function provisionPreRegisteredUser(
  input: { email: string; userId: string },
  dependencies: PreRegistrationProvisioningDependencies = defaultDependencies,
): Promise<"applied" | "unmatched"> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const registration = await dependencies.findRegistrationByEmail(normalizedEmail);
  if (!registration) {
    return "unmatched";
  }
  await dependencies.applyRegistration(registration, input.userId);
  await dependencies.reconcileWorkspaceReportingLines(registration.workspaceSlug);
  return "applied";
}

export async function provisionPreRegisteredUserByEmail(
  email: string,
): Promise<"applied" | "unmatched"> {
  const normalizedEmail = email.trim().toLowerCase();
  const [registeredUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .limit(1);
  if (!registeredUser) {
    return "unmatched";
  }
  return provisionPreRegisteredUser({ email: normalizedEmail, userId: registeredUser.id });
}
