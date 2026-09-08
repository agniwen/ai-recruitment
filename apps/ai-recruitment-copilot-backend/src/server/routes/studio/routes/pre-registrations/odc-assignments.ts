import { and, eq, inArray, sql } from "drizzle-orm";
import type { PreRegistrationOdcAssignment } from "@arc/db-schema/pre-registration";
import {
  member,
  organizationRole,
  resumeSource,
  resumeSourceOdcMember,
} from "@arc/db-schema/schema";
import type { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function validatePreRegistrationOdcAssignments(
  tx: Transaction,
  organizationId: string,
  workspaceRole: string,
  assignments: PreRegistrationOdcAssignment[],
): Promise<"invalid_odc_role" | "invalid_resume_source" | null> {
  if (assignments.length === 0) {
    return null;
  }
  const [role] = await tx
    .select({ isOdc: organizationRole.isOdc })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.role, workspaceRole),
      ),
    );
  if (!role?.isOdc) {
    return "invalid_odc_role";
  }
  const sources = await tx
    .select({ id: resumeSource.id })
    .from(resumeSource)
    .where(
      and(
        eq(resumeSource.organizationId, organizationId),
        inArray(
          resumeSource.id,
          assignments.map((item) => item.resumeSourceId),
        ),
      ),
    );
  return sources.length === assignments.length ? null : "invalid_resume_source";
}

export async function applyPreRegistrationOdcAssignments({
  tx,
  organizationId,
  userId,
  assignments,
  previousAssignments = [],
}: {
  tx: Transaction;
  organizationId: string;
  userId: string;
  assignments: PreRegistrationOdcAssignment[];
  previousAssignments?: PreRegistrationOdcAssignment[];
}): Promise<void> {
  if (assignments.length === 0 && previousAssignments.length === 0) {
    return;
  }
  const [workspaceMember] = await tx
    .select({ id: member.id, isOdc: organizationRole.isOdc })
    .from(member)
    .leftJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
      ),
    )
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
  if (!workspaceMember) {
    return;
  }
  const selectedIds = new Set(assignments.map((item) => item.resumeSourceId));
  const removedIds = previousAssignments
    .filter((item) => !selectedIds.has(item.resumeSourceId))
    .map((item) => item.resumeSourceId);
  if (removedIds.length > 0) {
    await tx
      .delete(resumeSourceOdcMember)
      .where(
        and(
          eq(resumeSourceOdcMember.organizationId, organizationId),
          eq(resumeSourceOdcMember.memberId, workspaceMember.id),
          inArray(resumeSourceOdcMember.resumeSourceId, removedIds),
        ),
      );
  }
  if (!workspaceMember.isOdc || assignments.length === 0) {
    return;
  }
  const sources = await tx
    .select({ id: resumeSource.id })
    .from(resumeSource)
    .where(
      and(
        eq(resumeSource.organizationId, organizationId),
        inArray(resumeSource.id, [...selectedIds]),
      ),
    );
  const existingIds = new Set(sources.map((source) => source.id));
  const values = assignments
    .filter((assignment) => existingIds.has(assignment.resumeSourceId))
    .map((assignment) => ({
      jobSeries: assignment.jobSeries,
      memberId: workspaceMember.id,
      organizationId,
      resumeSourceId: assignment.resumeSourceId,
      serviceUnit: assignment.serviceUnit?.trim() || null,
    }));
  if (values.length > 0) {
    await tx
      .insert(resumeSourceOdcMember)
      .values(values)
      .onConflictDoUpdate({
        set: { jobSeries: sql`excluded.job_series`, serviceUnit: sql`excluded.service_unit` },
        target: [resumeSourceOdcMember.resumeSourceId, resumeSourceOdcMember.memberId],
      });
  }
}
