import { and, eq, isNull } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, jobDescription, resumePoolEvent, resumePoolItem } from "@arc/db-schema/schema";
import { buildDepartmentHiringUnitScopeCondition } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import type { HiringUnitAccessScope } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";

interface BindResumePoolItemJobDescriptionInput {
  actorId: string | null;
  hiringUnitScope: HiringUnitAccessScope;
  jobDescriptionId: string;
  organizationId: string;
  poolItemId: string;
}

export async function bindResumePoolItemJobDescription(
  input: BindResumePoolItemJobDescriptionInput,
): Promise<"already_bound" | "bound" | "job_description_not_found"> {
  return await db.transaction(async (tx) => {
    const scopeCondition = buildDepartmentHiringUnitScopeCondition(input.hiringUnitScope);
    const [visibleJobDescription] = await tx
      .select({ id: jobDescription.id })
      .from(jobDescription)
      .innerJoin(department, eq(jobDescription.departmentId, department.id))
      .where(
        and(
          eq(jobDescription.id, input.jobDescriptionId),
          eq(jobDescription.organizationId, input.organizationId),
          scopeCondition,
        ),
      )
      .limit(1)
      .for("update", { of: jobDescription });
    if (!visibleJobDescription) {
      return "job_description_not_found";
    }

    const updated = await tx
      .update(resumePoolItem)
      .set({ jobDescriptionId: input.jobDescriptionId, updatedAt: new Date() })
      .where(
        and(
          eq(resumePoolItem.id, input.poolItemId),
          eq(resumePoolItem.organizationId, input.organizationId),
          isNull(resumePoolItem.jobDescriptionId),
        ),
      )
      .returning({ id: resumePoolItem.id });
    if (updated.length === 0) {
      return "already_bound";
    }

    await tx.insert(resumePoolEvent).values({
      actorId: input.actorId,
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      payload: { jobDescriptionId: input.jobDescriptionId },
      poolItemId: input.poolItemId,
      type: "bound",
    });
    return "bound";
  });
}
