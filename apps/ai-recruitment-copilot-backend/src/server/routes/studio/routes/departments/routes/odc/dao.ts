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
import { department, departmentOdcMember, member, user } from "@arc/db-schema/schema";
import { parseOdcAssignmentPagination } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/routes/odc/schema";

export function createDepartmentOdcAssignment({
  departmentId,
  input,
  organizationId,
}: {
  departmentId: string;
  input: OdcAssignmentCreateInput;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(departmentOdcMember)
      .values({
        departmentId,
        jobSeries: input.jobSeries ?? null,
        memberId: input.memberId,
        organizationId,
        serviceUnit: input.serviceUnit?.trim() || null,
      })
      .onConflictDoNothing()
      .returning({ memberId: departmentOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(department)
      .set({ updatedAt: new Date() })
      .where(and(eq(department.id, departmentId), eq(department.organizationId, organizationId)));
    return true;
  });
}

export async function queryPaginatedDepartmentOdcAssignments({
  departmentId,
  organizationId,
  pagination,
}: {
  departmentId: string;
  organizationId: string;
  pagination?: Record<string, unknown>;
}): Promise<PaginatedOdcAssignmentResult> {
  const { page, pageSize } = parseOdcAssignmentPagination(pagination);
  const where = and(
    eq(departmentOdcMember.departmentId, departmentId),
    eq(departmentOdcMember.organizationId, organizationId),
  );
  const [rows, totalRows, assignedRows] = await Promise.all([
    db
      .select({
        createdAt: departmentOdcMember.createdAt,
        email: user.email,
        image: user.image,
        jobSeries: departmentOdcMember.jobSeries,
        memberId: member.id,
        name: user.name,
        serviceUnit: departmentOdcMember.serviceUnit,
        userId: user.id,
      })
      .from(departmentOdcMember)
      .innerJoin(member, eq(departmentOdcMember.memberId, member.id))
      .innerJoin(user, eq(member.userId, user.id))
      .where(where)
      .orderBy(desc(departmentOdcMember.createdAt), asc(user.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(departmentOdcMember).where(where),
    db.select({ memberId: departmentOdcMember.memberId }).from(departmentOdcMember).where(where),
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

export function replaceDepartmentOdcMembers({
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
      .update(department)
      .set({ updatedAt: new Date() })
      .where(and(eq(department.id, id), eq(department.organizationId, organizationId)))
      .returning({ id: department.id });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .delete(departmentOdcMember)
      .where(
        and(
          eq(departmentOdcMember.departmentId, id),
          eq(departmentOdcMember.organizationId, organizationId),
        ),
      );
    if (assignments.length > 0) {
      await tx.insert(departmentOdcMember).values(
        assignments.map((assignment) => ({
          departmentId: id,
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

export function updateDepartmentOdcAssignment({
  departmentId,
  input,
  memberId,
  organizationId,
}: {
  departmentId: string;
  input: OdcAssignmentUpdateInput;
  memberId: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(departmentOdcMember)
      .set({
        jobSeries: input.jobSeries ?? null,
        serviceUnit: input.serviceUnit?.trim() || null,
      })
      .where(
        and(
          eq(departmentOdcMember.departmentId, departmentId),
          eq(departmentOdcMember.memberId, memberId),
          eq(departmentOdcMember.organizationId, organizationId),
        ),
      )
      .returning({ memberId: departmentOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(department)
      .set({ updatedAt: new Date() })
      .where(and(eq(department.id, departmentId), eq(department.organizationId, organizationId)));
    return true;
  });
}

export function deleteDepartmentOdcAssignment({
  departmentId,
  memberId,
  organizationId,
}: {
  departmentId: string;
  memberId: string;
  organizationId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(departmentOdcMember)
      .where(
        and(
          eq(departmentOdcMember.departmentId, departmentId),
          eq(departmentOdcMember.memberId, memberId),
          eq(departmentOdcMember.organizationId, organizationId),
        ),
      )
      .returning({ memberId: departmentOdcMember.memberId });
    if (rows.length === 0) {
      return false;
    }
    await tx
      .update(department)
      .set({ updatedAt: new Date() })
      .where(and(eq(department.id, departmentId), eq(department.organizationId, organizationId)));
    return true;
  });
}
