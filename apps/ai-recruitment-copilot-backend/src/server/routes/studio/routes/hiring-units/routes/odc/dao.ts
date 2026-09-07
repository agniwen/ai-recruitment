import type {
  OdcAssignmentItem,
  OdcAssignmentUpdateInput,
  PaginatedOdcAssignmentResult,
} from "@arc/shared/hiring-units";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { calcTotalPages } from "@arc/ai-recruitment-copilot-backend/lib/server/db/pagination";
import { serializeDate } from "@arc/ai-recruitment-copilot-backend/lib/server/db/serialize";
import { hiringUnit, hiringUnitOdcMember, member, user } from "@arc/db-schema/schema";
import { parseOdcAssignmentPagination } from "./schema";

export async function queryPaginatedHiringUnitOdcAssignments({
  hiringUnitId,
  organizationId,
  pagination,
}: {
  hiringUnitId: string;
  organizationId: string;
  pagination?: Record<string, unknown>;
}): Promise<PaginatedOdcAssignmentResult> {
  const { page, pageSize } = parseOdcAssignmentPagination(pagination);
  const where = and(
    eq(hiringUnitOdcMember.hiringUnitId, hiringUnitId),
    eq(hiringUnitOdcMember.organizationId, organizationId),
  );
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        createdAt: hiringUnitOdcMember.createdAt,
        email: user.email,
        image: user.image,
        jobSeries: hiringUnitOdcMember.jobSeries,
        memberId: member.id,
        name: user.name,
        serviceUnit: hiringUnitOdcMember.serviceUnit,
        userId: user.id,
      })
      .from(hiringUnitOdcMember)
      .innerJoin(member, eq(hiringUnitOdcMember.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(where)
      .orderBy(desc(hiringUnitOdcMember.createdAt), asc(user.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(hiringUnitOdcMember).where(where),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    page,
    pageSize,
    records: rows.map((row) => ({ ...row, createdAt: serializeDate(row.createdAt) })),
    total,
    totalPages: calcTotalPages(total, pageSize),
  };
}

export function replaceHiringUnitOdcMembers({
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
      .update(hiringUnit)
      .set({ updatedAt: new Date() })
      .where(and(eq(hiringUnit.id, id), eq(hiringUnit.organizationId, organizationId)))
      .returning({ id: hiringUnit.id });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .delete(hiringUnitOdcMember)
      .where(
        and(
          eq(hiringUnitOdcMember.hiringUnitId, id),
          eq(hiringUnitOdcMember.organizationId, organizationId),
        ),
      );
    if (assignments.length > 0) {
      await tx.insert(hiringUnitOdcMember).values(
        assignments.map((assignment) => ({
          hiringUnitId: id,
          jobSeries: assignment.jobSeries ?? null,
          memberId: assignment.memberId,
          organizationId,
          serviceUnit: assignment.serviceUnit?.trim() || null,
        })),
      );
    }
    return true;
  });
}

export function updateHiringUnitOdcAssignment({
  hiringUnitId,
  input,
  memberId,
  organizationId,
}: {
  hiringUnitId: string;
  input: OdcAssignmentUpdateInput;
  memberId: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(hiringUnitOdcMember)
      .set({
        jobSeries: input.jobSeries ?? null,
        serviceUnit: input.serviceUnit?.trim() || null,
      })
      .where(
        and(
          eq(hiringUnitOdcMember.hiringUnitId, hiringUnitId),
          eq(hiringUnitOdcMember.memberId, memberId),
          eq(hiringUnitOdcMember.organizationId, organizationId),
        ),
      )
      .returning({ memberId: hiringUnitOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(hiringUnit)
      .set({ updatedAt: new Date() })
      .where(and(eq(hiringUnit.id, hiringUnitId), eq(hiringUnit.organizationId, organizationId)));
    return true;
  });
}

export function deleteHiringUnitOdcAssignment({
  hiringUnitId,
  memberId,
  organizationId,
}: {
  hiringUnitId: string;
  memberId: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(hiringUnitOdcMember)
      .where(
        and(
          eq(hiringUnitOdcMember.hiringUnitId, hiringUnitId),
          eq(hiringUnitOdcMember.memberId, memberId),
          eq(hiringUnitOdcMember.organizationId, organizationId),
        ),
      )
      .returning({ memberId: hiringUnitOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(hiringUnit)
      .set({ updatedAt: new Date() })
      .where(and(eq(hiringUnit.id, hiringUnitId), eq(hiringUnit.organizationId, organizationId)));
    return true;
  });
}
