import type {
  OdcAssignmentCreateInput,
  OdcAssignmentItem,
  OdcAssignmentUpdateInput,
  PaginatedOdcAssignmentResult,
} from "@arc/shared/hiring-units";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { calcTotalPages } from "@arc/ai-recruitment-copilot-backend/lib/server/db/pagination";
import { serializeDate } from "@arc/ai-recruitment-copilot-backend/lib/server/db/serialize";
import { resumeSource, resumeSourceOdcMember, member, user } from "@arc/db-schema/schema";
import { parseOdcAssignmentPagination } from "../../../hiring-units/routes/odc/schema";

export function createResumeSourceOdcAssignment({
  resumeSourceId,
  input,
  organizationId,
}: {
  resumeSourceId: string;
  input: OdcAssignmentCreateInput;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(resumeSourceOdcMember)
      .values({
        jobSeries: input.jobSeries ?? null,
        memberId: input.memberId,
        organizationId,
        resumeSourceId,
        serviceUnit: input.serviceUnit?.trim() || null,
      })
      .onConflictDoNothing()
      .returning({ memberId: resumeSourceOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(resumeSource)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(resumeSource.id, resumeSourceId), eq(resumeSource.organizationId, organizationId)),
      );
    return true;
  });
}

export async function queryPaginatedResumeSourceOdcAssignments({
  resumeSourceId,
  organizationId,
  pagination,
}: {
  resumeSourceId: string;
  organizationId: string;
  pagination?: Record<string, unknown>;
}): Promise<PaginatedOdcAssignmentResult> {
  const { page, pageSize } = parseOdcAssignmentPagination(pagination);
  const where = and(
    eq(resumeSourceOdcMember.resumeSourceId, resumeSourceId),
    eq(resumeSourceOdcMember.organizationId, organizationId),
  );
  const [rows, totalRows, assignedRows] = await Promise.all([
    db
      .select({
        createdAt: resumeSourceOdcMember.createdAt,
        email: user.email,
        image: user.image,
        jobSeries: resumeSourceOdcMember.jobSeries,
        memberId: member.id,
        name: user.name,
        serviceUnit: resumeSourceOdcMember.serviceUnit,
        userId: user.id,
      })
      .from(resumeSourceOdcMember)
      .innerJoin(member, eq(resumeSourceOdcMember.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(where)
      .orderBy(desc(resumeSourceOdcMember.createdAt), asc(user.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(resumeSourceOdcMember).where(where),
    db
      .select({ memberId: resumeSourceOdcMember.memberId })
      .from(resumeSourceOdcMember)
      .where(where),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    assignedMemberIds: assignedRows.map((row) => row.memberId),
    page,
    pageSize,
    records: rows.map((row) => ({ ...row, createdAt: serializeDate(row.createdAt) })),
    total,
    totalPages: calcTotalPages(total, pageSize),
  };
}

export function replaceResumeSourceOdcMembers({
  assignments,
  id,
  organizationId,
}: {
  assignments: OdcAssignmentItem[];
  id: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(resumeSource)
      .set({ updatedAt: new Date() })
      .where(and(eq(resumeSource.id, id), eq(resumeSource.organizationId, organizationId)))
      .returning({ id: resumeSource.id });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .delete(resumeSourceOdcMember)
      .where(
        and(
          eq(resumeSourceOdcMember.resumeSourceId, id),
          eq(resumeSourceOdcMember.organizationId, organizationId),
        ),
      );
    if (assignments.length > 0) {
      await tx.insert(resumeSourceOdcMember).values(
        assignments.map((assignment) => ({
          jobSeries: assignment.jobSeries ?? null,
          memberId: assignment.memberId,
          organizationId,
          resumeSourceId: id,
          serviceUnit: assignment.serviceUnit?.trim() || null,
        })),
      );
    }
    return true;
  });
}

export function updateResumeSourceOdcAssignment({
  resumeSourceId,
  input,
  memberId,
  organizationId,
}: {
  resumeSourceId: string;
  input: OdcAssignmentUpdateInput;
  memberId: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(resumeSourceOdcMember)
      .set({
        jobSeries: input.jobSeries ?? null,
        serviceUnit: input.serviceUnit?.trim() || null,
      })
      .where(
        and(
          eq(resumeSourceOdcMember.resumeSourceId, resumeSourceId),
          eq(resumeSourceOdcMember.memberId, memberId),
          eq(resumeSourceOdcMember.organizationId, organizationId),
        ),
      )
      .returning({ memberId: resumeSourceOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(resumeSource)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(resumeSource.id, resumeSourceId), eq(resumeSource.organizationId, organizationId)),
      );
    return true;
  });
}

export function deleteResumeSourceOdcAssignment({
  resumeSourceId,
  memberId,
  organizationId,
}: {
  resumeSourceId: string;
  memberId: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(resumeSourceOdcMember)
      .where(
        and(
          eq(resumeSourceOdcMember.resumeSourceId, resumeSourceId),
          eq(resumeSourceOdcMember.memberId, memberId),
          eq(resumeSourceOdcMember.organizationId, organizationId),
        ),
      )
      .returning({ memberId: resumeSourceOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(resumeSource)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(resumeSource.id, resumeSourceId), eq(resumeSource.organizationId, organizationId)),
      );
    return true;
  });
}
