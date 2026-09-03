import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  member,
  memberReportingLine,
  organization,
  platformPreRegistration,
  recruitingGroup,
  recruitingGroupMember,
  user,
} from "@arc/db-schema/schema";
import type { PreRegistrationRecruitingRole } from "./schema";

export interface PreRegistrationProvisioningRecord {
  directManagerId: string | null;
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
  registeredRows: readonly {
    directManagerId: string | null;
    memberId: string;
    preRegistrationId: string;
  }[],
  organizationId: string,
) {
  const memberIdByPreRegistrationId = new Map(
    registeredRows.map((row) => [row.preRegistrationId, row.memberId]),
  );
  return {
    managedMemberIds: registeredRows.map((row) => row.memberId),
    reportingLines: registeredRows.flatMap((row) => {
      const directManagerMemberId = row.directManagerId
        ? memberIdByPreRegistrationId.get(row.directManagerId)
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
  rows: readonly { directManagerId: string | null; id: string }[],
): boolean {
  const managerById = new Map(rows.map((row) => [row.id, row.directManagerId]));
  for (const row of rows) {
    const visited = new Set<string>();
    let currentId: string | null | undefined = row.id;
    while (currentId) {
      if (visited.has(currentId)) {
        return true;
      }
      visited.add(currentId);
      currentId = managerById.get(currentId);
    }
  }
  return false;
}

async function findRegistrationByEmail(
  normalizedEmail: string,
): Promise<PreRegistrationProvisioningRecord | null> {
  const [registration] = await db
    .select({
      directManagerId: platformPreRegistration.directManagerId,
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
        eq(platformPreRegistration.workspaceSlug, "work"),
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

  const registeredRows = await db
    .select({
      directManagerId: platformPreRegistration.directManagerId,
      memberId: member.id,
      preRegistrationId: platformPreRegistration.id,
    })
    .from(platformPreRegistration)
    .innerJoin(user, sql`lower(${user.email}) = lower(${platformPreRegistration.email})`)
    .innerJoin(member, and(eq(member.userId, user.id), eq(member.organizationId, workspace.id)))
    .where(eq(platformPreRegistration.workspaceSlug, workspaceSlug));

  const { managedMemberIds, reportingLines } = buildRegisteredReportingLines(
    registeredRows,
    workspace.id,
  );

  await db.transaction(async (tx) => {
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
