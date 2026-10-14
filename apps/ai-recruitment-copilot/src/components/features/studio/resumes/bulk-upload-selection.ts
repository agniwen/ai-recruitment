import type { ResumePoolImportOptions } from "@arc/shared/resume-pool";

type SelectionOptions = Pick<ResumePoolImportOptions, "departments" | "hiringUnits"> & {
  jobDescriptions: (Pick<
    ResumePoolImportOptions["jobDescriptions"][number],
    "id" | "name" | "hiringUnitId" | "departmentId" | "departmentName" | "serviceUnit"
  > & { code?: string | null })[];
};

export interface BulkUploadSelection {
  jobNames: string[];
  hiringUnitIds: string[];
  excludedJobIds?: string[];
}

// Names identify the visible job groups; IDs identify concrete destinations.
export function bulkUploadSelectionModel(
  options: SelectionOptions,
  selection: BulkUploadSelection,
) {
  const units = [...new Map(options.hiringUnits.map((unit) => [unit.id, unit])).values()];
  const unitIds = new Set(units.map((unit) => unit.id));
  const jobs = [...new Map(options.jobDescriptions.map((job) => [job.id, job])).values()].filter(
    (job): job is typeof job & { hiringUnitId: string } =>
      job.hiringUnitId !== null && unitIds.has(job.hiringUnitId),
  );
  const names = new Set(selection.jobNames);
  const selectedUnits = new Set(selection.hiringUnitIds);
  // Narrow available options while keeping existing selections visible.
  const jobOptions = [
    ...new Set(
      jobs
        .filter(
          (job) =>
            selectedUnits.size === 0 ||
            selectedUnits.has(job.hiringUnitId) ||
            names.has(job.name.trim()),
        )
        .map((job) => job.name.trim()),
    ),
  ]
    .toSorted((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => ({ label: name, value: name }));
  const unitOptions = units
    .filter(
      (unit) =>
        selectedUnits.has(unit.id) ||
        jobs.some(
          (job) => job.hiringUnitId === unit.id && (names.size === 0 || names.has(job.name.trim())),
        ),
    )
    .map((unit) => {
      const departmentNames = [
        ...new Set(
          jobs
            .filter((job) => job.hiringUnitId === unit.id)
            .map(
              (job) =>
                job.departmentName ||
                options.departments.find((dept) => dept.id === job.departmentId)?.name,
            )
            .filter(Boolean),
        ),
      ].join("、");
      return {
        label: departmentNames ? `${unit.name} / ${departmentNames}` : unit.name,
        value: unit.id,
      };
    });
  const availableDestinations =
    names.size === 0
      ? []
      : jobs.filter((job) => names.has(job.name.trim()) && selectedUnits.has(job.hiringUnitId));
  const excludedJobIds = new Set(selection.excludedJobIds);
  const destinations = availableDestinations.filter((job) => !excludedJobIds.has(job.id));
  return { availableDestinations, destinations, jobOptions, unitOptions };
}

export function toggleBulkUploadDestination(
  selection: BulkUploadSelection,
  jobId: string,
  checked: boolean,
): BulkUploadSelection {
  const excludedJobIds = new Set(selection.excludedJobIds);
  if (checked) {
    excludedJobIds.delete(jobId);
  } else {
    excludedJobIds.add(jobId);
  }
  return { ...selection, excludedJobIds: [...excludedJobIds] };
}

export function changeBulkUploadSelection(
  selection: BulkUploadSelection,
  field: "jobNames" | "hiringUnitIds",
  values: string[],
): BulkUploadSelection {
  return { ...selection, [field]: [...new Set(values)] };
}
