import { and, notExists, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { sscResponsibility } from "@arc/db-schema/schema";

interface JobScopeColumns {
  organizationId: SQLWrapper;
  resumeSourceId: SQLWrapper;
  serviceUnit: SQLWrapper;
  departmentId: SQLWrapper;
}

function matchesJob(responsibility: JobScopeColumns, job: JobScopeColumns) {
  return sql`
    ${responsibility.organizationId} = ${job.organizationId}
    and ${responsibility.resumeSourceId} = ${job.resumeSourceId}
    and (
      nullif(btrim(${responsibility.serviceUnit}), '') is null
      or lower(btrim(${responsibility.serviceUnit})) = lower(btrim(${job.serviceUnit}))
    )
    and (${responsibility.departmentId} is null or ${responsibility.departmentId} = ${job.departmentId})
  `;
}

function specificity(responsibility: JobScopeColumns) {
  return sql`
    (case when nullif(btrim(${responsibility.serviceUnit}), '') is null then 0 else 1 end
    + case when ${responsibility.departmentId} is null then 0 else 1 end)
  `;
}

/** Use the candidate's current job, with narrower matching scopes taking precedence. */
export function buildSscResponsibilityJobScopeCondition(
  responsibility: JobScopeColumns,
  job: JobScopeColumns,
) {
  const moreSpecific = alias(sscResponsibility, "ssc_more_specific_responsibility");
  return (
    and(
      matchesJob(responsibility, job),
      // Rank every configured scope before resolving identities or TG bindings.
      // An unavailable specific SSC must not redirect private Offer data to a generic SSC.
      notExists(
        db
          .select({ value: sql`1` })
          .from(moreSpecific)
          .where(
            and(
              matchesJob(moreSpecific, job),
              sql`${specificity(moreSpecific)} > ${specificity(responsibility)}`,
            ),
          ),
      ),
    ) ?? sql`false`
  );
}
