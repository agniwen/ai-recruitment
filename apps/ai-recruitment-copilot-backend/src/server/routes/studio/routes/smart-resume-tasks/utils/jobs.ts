import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { jobDescription, jobMatchingProfile } from "@arc/db-schema/schema";
import { loadResumePoolImportOptions } from "../../resume-pool/routes/import/options";
const { jobDescriptionId: profileJobIdColumn, ...profileColumns } =
  getTableColumns(jobMatchingProfile);

// Resolve the current job-level source/center scope before loading any JD text.
export async function loadEligibleSmartJobs(organizationId: string, userId: string) {
  const options = await loadResumePoolImportOptions(organizationId, userId);
  const accessible = options.jobDescriptions.filter((job) => job.hiringUnitId);
  if (!accessible.length) {
    return [];
  }
  const rows = await db
    .select({
      job: jobDescription,
      matching: {
        jobDescriptionId: profileJobIdColumn,
        ...profileColumns,
      },
    })
    .from(jobDescription)
    .leftJoin(jobMatchingProfile, eq(jobMatchingProfile.jobDescriptionId, jobDescription.id))
    .where(
      and(
        eq(jobDescription.organizationId, organizationId),
        inArray(
          jobDescription.id,
          accessible.map((job) => job.id),
        ),
      ),
    );
  return accessible.flatMap((option) => {
    const row = rows.find((entry) => entry.job.id === option.id);
    if (!row || !option.hiringUnitId) {
      return [];
    }
    return [
      {
        ...row,
        option: {
          departmentName: option.departmentName ?? null,
          hiringUnitId: option.hiringUnitId,
          hiringUnitName: option.hiringUnitName,
          id: option.id,
          name: option.name,
          resumeSourceName: option.resumeSourceName ?? null,
        },
      },
    ];
  });
}

export type EligibleSmartJob = Awaited<ReturnType<typeof loadEligibleSmartJobs>>[number];
