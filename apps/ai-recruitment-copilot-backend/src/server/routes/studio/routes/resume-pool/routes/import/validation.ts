import type {
  ResumePoolBatchImportInput,
  ResumePoolImportDestination,
  ResumePoolImportOptions,
} from "@arc/shared/resume-pool";

function validateUnboundDestination(
  destination: ResumePoolImportDestination,
  options: ResumePoolImportOptions,
) {
  const selectedDepartment = options.departments.find((row) => row.id === destination.departmentId);
  if (destination.departmentId && selectedDepartment?.hiringUnitId !== destination.hiringUnitId) {
    throw new Error("所选部门不属于该入库组织。");
  }
  if (
    destination.serviceUnit &&
    !options.jobDescriptions.some(
      (row) =>
        row.hiringUnitId === destination.hiringUnitId &&
        (!destination.departmentId || row.departmentId === destination.departmentId) &&
        row.serviceUnit === destination.serviceUnit,
    )
  ) {
    throw new Error("所选服务单位不属于当前入库去向。");
  }
  return { ...destination, departmentName: selectedDepartment?.name ?? null };
}

export function validateImportDestinations(
  input: Pick<ResumePoolBatchImportInput, "destinations" | "jobDescriptionMode">,
  options: ResumePoolImportOptions,
) {
  const jobNames = new Set<string>();
  return input.destinations.map((destination) => {
    const unit = options.hiringUnits.find((row) => row.id === destination.hiringUnitId);
    if (!unit) {
      throw new Error("所选入库组织不在当前负责范围内。");
    }
    if (!destination.jobDescriptionId) {
      if (input.jobDescriptionMode === "bind") {
        throw new Error("请选择各组织对应的岗位去向。");
      }
      if (unit.canImportWithoutJob === false) {
        throw new Error("所选入库组织需要绑定有权限的具体岗位。");
      }
      return validateUnboundDestination(destination, options);
    }
    const job = options.jobDescriptions.find((row) => row.id === destination.jobDescriptionId);
    if (!job || job.hiringUnitId !== destination.hiringUnitId) {
      throw new Error("所选岗位与入库组织不匹配，请重新选择。");
    }
    jobNames.add(job.name.trim());
    if (jobNames.size > 1) {
      throw new Error("请选择同一岗位名称下的入库去向。");
    }
    if (destination.departmentId && destination.departmentId !== job.departmentId) {
      throw new Error("所选部门与岗位不匹配。");
    }
    if (destination.serviceUnit && destination.serviceUnit !== job.serviceUnit) {
      throw new Error("所选服务单位与岗位不匹配。");
    }
    return {
      ...destination,
      departmentId: job.departmentId,
      departmentName: job.departmentName,
      serviceUnit: job.serviceUnit,
    };
  });
}
