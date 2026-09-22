import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  member,
  organizationRole,
  resumeSource,
  resumeSourceOdcMember,
  user,
} from "@arc/db-schema/schema";
import type { MemberOdcScopeInput } from "@arc/db-schema/pre-registration";

export async function listMemberOdcScopes(organizationId: string) {
  const [members, assignments, sources] = await Promise.all([
    db
      .select({
        email: user.email,
        isOdc: organizationRole.isOdc,
        memberId: member.id,
        odcScopeMode: member.odcScopeMode,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .leftJoin(
        organizationRole,
        and(
          eq(organizationRole.organizationId, member.organizationId),
          eq(organizationRole.role, member.role),
        ),
      )
      .where(eq(member.organizationId, organizationId)),
    db
      .select({
        jobSeries: resumeSourceOdcMember.jobSeries,
        memberId: resumeSourceOdcMember.memberId,
        resumeSourceId: resumeSourceOdcMember.resumeSourceId,
        serviceUnit: resumeSourceOdcMember.serviceUnit,
      })
      .from(resumeSourceOdcMember)
      .where(eq(resumeSourceOdcMember.organizationId, organizationId)),
    db
      .select({ id: resumeSource.id, name: resumeSource.name })
      .from(resumeSource)
      .where(eq(resumeSource.organizationId, organizationId))
      .orderBy(asc(resumeSource.name)),
  ]);
  const byMember = new Map<string, MemberOdcScopeInput["odcAssignments"]>();
  for (const { memberId, ...assignment } of assignments) {
    const values = byMember.get(memberId) ?? [];
    values.push(assignment);
    byMember.set(memberId, values);
  }
  return {
    records: members.map((row) => ({
      ...row,
      isOdc: row.isOdc === true,
      odcAssignments: byMember.get(row.memberId) ?? [],
    })),
    sources,
  };
}

export function updateMemberOdcScope(
  organizationId: string,
  memberId: string,
  input: MemberOdcScopeInput,
) {
  return db.transaction(async (tx) => {
    // Serialize against source-side writes, which also lock the member row.
    const [target] = await tx
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.id, memberId)))
      .for("update");
    if (!target) {
      return "not_found" as const;
    }
    const [role] = await tx
      .select({ isOdc: organizationRole.isOdc })
      .from(organizationRole)
      .where(
        and(
          eq(organizationRole.organizationId, organizationId),
          eq(organizationRole.role, target.role),
        ),
      );
    if (!role?.isOdc) {
      return "not_odc" as const;
    }
    if (input.odcScopeMode === "selected") {
      const ids = input.odcAssignments.map((row) => row.resumeSourceId);
      const valid = ids.length
        ? await tx
            .select({ id: resumeSource.id })
            .from(resumeSource)
            .where(
              and(eq(resumeSource.organizationId, organizationId), inArray(resumeSource.id, ids)),
            )
        : [];
      if (valid.length !== ids.length) {
        return "invalid_source" as const;
      }
      await tx
        .delete(resumeSourceOdcMember)
        .where(
          and(
            eq(resumeSourceOdcMember.organizationId, organizationId),
            eq(resumeSourceOdcMember.memberId, memberId),
            ids.length ? notInArray(resumeSourceOdcMember.resumeSourceId, ids) : undefined,
          ),
        );
      if (ids.length) {
        await tx
          .insert(resumeSourceOdcMember)
          .values(
            input.odcAssignments.map((row) => ({
              ...row,
              memberId,
              organizationId,
              serviceUnit: row.serviceUnit?.trim() || null,
            })),
          )
          .onConflictDoUpdate({
            set: { jobSeries: sql`excluded.job_series`, serviceUnit: sql`excluded.service_unit` },
            target: [resumeSourceOdcMember.resumeSourceId, resumeSourceOdcMember.memberId],
          });
      }
    }
    await tx
      .update(member)
      .set({ odcScopeMode: input.odcScopeMode })
      .where(eq(member.id, memberId));
    return "updated" as const;
  });
}
