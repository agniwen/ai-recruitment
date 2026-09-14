import { and, eq, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, hiringUnit } from "@arc/db-schema/schema";
import type { ResumePoolImportOptions } from "@arc/shared/resume-pool";
import { resolveHiringUnitAccessScope } from "../../../../utils/hiring-unit-scope";
import { listAllJobDescriptions } from "../../../job-descriptions/dao";

export async function loadResumePoolImportOptions(
  organizationId: string,
  actorUserId: string,
): Promise<ResumePoolImportOptions> {
  const scope = await resolveHiringUnitAccessScope({ actorUserId, organizationId });
  const units = await db
    .select({ id: hiringUnit.id, name: hiringUnit.name })
    .from(hiringUnit)
    .where(
      and(
        eq(hiringUnit.organizationId, organizationId),
        scope.canAccessAll ? undefined : inArray(hiringUnit.id, scope.hiringUnitIds),
      ),
    )
    .orderBy(hiringUnit.name);
  const [departments, jobs] = await Promise.all([
    db
      .select({ hiringUnitId: department.hiringUnitId, id: department.id, name: department.name })
      .from(department)
      .where(
        and(
          eq(department.organizationId, organizationId),
          inArray(
            department.hiringUnitId,
            units.map((unit) => unit.id),
          ),
        ),
      )
      .orderBy(department.name),
    listAllJobDescriptions(organizationId, { actorUserId }),
  ]);
  return {
    departments,
    hiringUnits: units,
    jobDescriptions: jobs.filter((job) => units.some((unit) => unit.id === job.hiringUnitId)),
  };
}
