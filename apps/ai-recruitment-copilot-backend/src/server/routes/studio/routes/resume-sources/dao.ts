import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  hiringUnit,
  member,
  resumeSource,
  resumeSourceOdcMember,
  user,
} from "@arc/db-schema/schema";
import type { ResumeSourceRecord } from "@arc/shared/resume-sources";

export async function loadResumeSourceById(id: string, organizationId: string) {
  const [record] = await db
    .select()
    .from(resumeSource)
    .where(and(eq(resumeSource.id, id), eq(resumeSource.organizationId, organizationId)))
    .limit(1);
  return record ?? null;
}

export async function listResumeSources(organizationId: string): Promise<ResumeSourceRecord[]> {
  const [sources, units, assignments] = await Promise.all([
    db
      .select()
      .from(resumeSource)
      .where(eq(resumeSource.organizationId, organizationId))
      .orderBy(asc(resumeSource.name)),
    db
      .select({ count: count(), sourceId: hiringUnit.resumeSourceId })
      .from(hiringUnit)
      .where(eq(hiringUnit.organizationId, organizationId))
      .groupBy(hiringUnit.resumeSourceId),
    db
      .select({
        email: user.email,
        image: user.image,
        jobSeries: resumeSourceOdcMember.jobSeries,
        memberId: member.id,
        name: user.name,
        serviceUnit: resumeSourceOdcMember.serviceUnit,
        sourceId: resumeSourceOdcMember.resumeSourceId,
        userId: user.id,
      })
      .from(resumeSourceOdcMember)
      .innerJoin(member, eq(member.id, resumeSourceOdcMember.memberId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(resumeSourceOdcMember.organizationId, organizationId))
      .orderBy(asc(user.name)),
  ]);
  const counts = new Map(units.map((unit) => [unit.sourceId, unit.count]));
  const members = new Map<string, ResumeSourceRecord["odcMembers"]>();
  for (const { sourceId, ...assignment } of assignments) {
    const group = members.get(sourceId) ?? [];
    group.push(assignment);
    members.set(sourceId, group);
  }
  return sources.map((source) => ({
    ...source,
    createdAt: source.createdAt.toISOString(),
    hiringUnitCount: counts.get(source.id) ?? 0,
    odcMembers: members.get(source.id) ?? [],
    updatedAt: source.updatedAt.toISOString(),
  }));
}
