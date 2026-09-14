import type { CreateBulkResumeBatchInput } from "@arc/shared/bulk-resume-upload";
import { loadJobDescriptionById } from "../../job-descriptions/dao";
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
    );
  }
  if (input.jdMode === "bind") {
    if (!input.jobDescriptionId) {
      throw new Error("绑定模式必须选择岗位。");
    }
    const jd = await loadJobDescriptionById(organizationId, input.jobDescriptionId, {
      actorUserId: userId,
    });
    if (!jd) {
      throw new Error("选择的岗位不存在或无权访问。");
    }
  }
}
