import type { CreateBulkResumeBatchInput } from "@arc/shared/bulk-resume-upload";
import { loadJobDescriptionById } from "../../job-descriptions/dao";
import { isJobDescriptionInactive } from "@arc/shared/job-descriptions";
import { loadResumePoolImportOptions } from "../../resume-pool/routes/import/options";
import { validateImportDestinations } from "../../resume-pool/routes/import/validation";

export async function validateBatchDestinations(
  input: CreateBulkResumeBatchInput,
  organizationId: string,
  userId: string,
) {
  if (input.destinations) {
    return validateImportDestinations(
      {
        destinations: input.destinations.map((row) => ({
          ...row,
          departmentId: null,
          serviceUnit: null,
        })),
        jobDescriptionMode: "bind",
      },
      await loadResumePoolImportOptions(organizationId, userId),
      true,
    );
  }
  if (input.jdMode === "bind") {
    if (!input.jobDescriptionId) {
      throw new Error("绑定模式必须选择岗位。");
    }
    const jd = await loadJobDescriptionById(organizationId, input.jobDescriptionId, {
      actorUserId: userId,
    });
    if (!jd || isJobDescriptionInactive(jd)) {
      throw new Error("选择的岗位不存在、已失效或无权访问。");
    }
  }
}
