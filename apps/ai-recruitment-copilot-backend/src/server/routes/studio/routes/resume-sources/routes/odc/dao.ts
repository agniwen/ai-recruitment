import type {
  OdcAssignmentItem,
  OdcAssignmentUpdateInput,
  PaginatedOdcAssignmentResult,
} from "@arc/shared/hiring-units";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { listAllSourceOdcMembers, lockSelectedOdcMembers } from "./all-scope";
import { HTTPException } from "hono/http-exception";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { calcTotalPages } from "@arc/ai-recruitment-copilot-backend/lib/server/db/pagination";
import { serializeDate } from "@arc/ai-recruitment-copilot-backend/lib/server/db/serialize";
import { resumeSource, resumeSourceOdcMember, member, user } from "@arc/db-schema/schema";
import { parseOdcAssignmentPagination } from "../../../hiring-units/routes/odc/schema";

class DuplicateOdcAssignmentError extends Error {
  override name = "DuplicateOdcAssignmentError";
}

export async function createResumeSourceOdcAssignments({
  resumeSourceId,
  assignments,
  organizationId,
}: {
  resumeSourceId: string;
  assignments: OdcAssignmentItem[];
  organizationId: string;
}): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      await lockSelectedOdcMembers(
        tx,
        organizationId,
        assignments.map((row) => row.memberId),
      );
      const rows = await tx
        .insert(resumeSourceOdcMember)
        .values(
          assignments.map((assignment) => ({
            canApproveAiReview: assignment.canApproveAiReview ?? false,
            jobSeries: assignment.jobSeries ?? null,
            memberId: assignment.memberId,
            organizationId,
            resumeSourceId,
            serviceUnit: assignment.serviceUnit?.trim() || null,
          })),
        )
        .onConflictDoNothing()
        .returning({ memberId: resumeSourceOdcMember.memberId });
      if (rows.length !== assignments.length) {
        throw new DuplicateOdcAssignmentError();
      }
      await tx
        .update(resumeSource)
        .set({ updatedAt: new Date() })
        .where(
          and(eq(resumeSource.id, resumeSourceId), eq(resumeSource.organizationId, organizationId)),
        );
      return true;
    });
  } catch (error) {
    if (error instanceof DuplicateOdcAssignmentError) {
      return false;
    }
    throw error;
  }
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
    eq(member.odcScopeMode, "selected"),
  );
  const [rows, allMembers] = await Promise.all([
    db
      .select({
        canApproveAiReview: resumeSourceOdcMember.canApproveAiReview,
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
      .orderBy(desc(resumeSourceOdcMember.createdAt), asc(user.name)),
    listAllSourceOdcMembers(organizationId),
  ]);
  const effectiveRows = [
    ...rows,
    ...allMembers.map((row) => ({ ...row, jobSeries: null, serviceUnit: null })),
  ].toSorted(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.name.localeCompare(b.name),
  );
  const total = effectiveRows.length;
  return {
    assignedMemberIds: effectiveRows.map((row) => row.memberId),
    page,
    pageSize,
    records: effectiveRows
      .slice((page - 1) * pageSize, page * pageSize)
      .map((row) => ({ ...row, createdAt: serializeDate(row.createdAt) })),
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
    const members = await tx
      .select({ id: member.id, odcScopeMode: member.odcScopeMode })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .orderBy(member.id)
      .for("update");
    const allMemberIds = new Set(
      members.filter((row) => row.odcScopeMode === "all").map((row) => row.id),
    );
    if (assignments.some((row) => allMemberIds.has(row.memberId))) {
      throw new HTTPException(409, {
        message: "该成员负责全部部门/中心，请前往成员与招聘组调整负责范围。",
      });
    }
    const selectedMembers = members.filter((row) => row.odcScopeMode === "selected");
    const rows = await tx
      .update(resumeSource)
      .set({ updatedAt: new Date() })
      .where(and(eq(resumeSource.id, id), eq(resumeSource.organizationId, organizationId)))
      .returning({ id: resumeSource.id });
    if (rows.length === 0) {
      return false;
    }
    await tx.delete(resumeSourceOdcMember).where(
      and(
        eq(resumeSourceOdcMember.resumeSourceId, id),
        eq(resumeSourceOdcMember.organizationId, organizationId),
        inArray(
          resumeSourceOdcMember.memberId,
          selectedMembers.map((row) => row.id),
        ),
        assignments.length
          ? notInArray(
              resumeSourceOdcMember.memberId,
              assignments.map((row) => row.memberId),
            )
          : undefined,
      ),
    );
    if (assignments.length > 0) {
      await tx
        .insert(resumeSourceOdcMember)
        .values(
          assignments.map((assignment) => ({
            canApproveAiReview: assignment.canApproveAiReview ?? false,
            jobSeries: assignment.jobSeries ?? null,
            memberId: assignment.memberId,
            organizationId,
            resumeSourceId: id,
            serviceUnit: assignment.serviceUnit?.trim() || null,
          })),
        )
        .onConflictDoUpdate({
          set: {
            canApproveAiReview: sql`excluded.can_approve_ai_review`,
            jobSeries: sql`excluded.job_series`,
            serviceUnit: sql`excluded.service_unit`,
          },
          target: [resumeSourceOdcMember.resumeSourceId, resumeSourceOdcMember.memberId],
        });
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
    await lockSelectedOdcMembers(tx, organizationId, [memberId]);
    const rows = await tx
      .update(resumeSourceOdcMember)
      .set({
        canApproveAiReview: input.canApproveAiReview,
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
    await lockSelectedOdcMembers(tx, organizationId, [memberId]);
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
