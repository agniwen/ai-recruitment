import type { ResumePoolImportDestination, ResumePoolImportOptions } from "@arc/shared/resume-pool";

export const EMPTY_IMPORT_OPTIONS: ResumePoolImportOptions = {
  departments: [],
  hiringUnits: [],
  jobDescriptions: [],
};

type ImportSelectionJob = Pick<
  ResumePoolImportOptions["jobDescriptions"][number],
  "id" | "name" | "hiringUnitId" | "departmentId" | "serviceUnit"
>;

export function matchingImportJobs<TJob extends ImportSelectionJob>(
  options: { jobDescriptions: TJob[] },
  name: string,
  destination: ResumePoolImportDestination,
) {
  return options.jobDescriptions.filter(
    (job) => (!name || job.name.trim() === name) && job.hiringUnitId === destination.hiringUnitId,
  );
}

export function importJobNameOptions(
  options: { jobDescriptions: ImportSelectionJob[] },
  destinations: ResumePoolImportDestination[],
) {
  const names = [...new Set(options.jobDescriptions.map((job) => job.name.trim()))];
  return names
    .filter((name) =>
      destinations.every(
        (destination) => matchingImportJobs(options, name, destination).length > 0,
      ),
    )
    .toSorted((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => ({ label: name, value: name }));
}

export function resolveImportDestination(
  options: { jobDescriptions: ImportSelectionJob[] },
  name: string,
  destination: ResumePoolImportDestination,
): ResumePoolImportDestination {
  if (!name) {
    return { ...destination, departmentId: null, jobDescriptionId: null, serviceUnit: null };
  }
  const matches = matchingImportJobs(options, name, destination);
  const selected =
    matches.find((job) => job.id === destination.jobDescriptionId) ??
    (matches.length === 1 ? matches[0] : null);
  return {
    ...destination,
    departmentId: selected?.departmentId ?? null,
    jobDescriptionId: selected?.id ?? null,
    serviceUnit: selected?.serviceUnit ?? null,
  };
}

export function emptyImportDestination(hiringUnitId: string): ResumePoolImportDestination {
  return { departmentId: null, hiringUnitId, jobDescriptionId: null, serviceUnit: null };
}

// A selected organization keeps one empty row until its concrete jobs are chosen.
export function resolveImportDestinations(
  options: { jobDescriptions: ImportSelectionJob[] },
  name: string,
  destinations: ResumePoolImportDestination[],
): ResumePoolImportDestination[] {
  return [...new Set(destinations.map((row) => row.hiringUnitId))].flatMap((hiringUnitId) => {
    const empty = emptyImportDestination(hiringUnitId);
    const selectedIds = new Set(
      destinations
        .filter((row) => row.hiringUnitId === hiringUnitId)
        .map((row) => row.jobDescriptionId),
    );
    const selectedJobs = name
      ? matchingImportJobs(options, name, empty).filter((job) => selectedIds.has(job.id))
      : [];
    return selectedJobs.length > 0
      ? selectedJobs.map((job) =>
          resolveImportDestination(options, name, { ...empty, jobDescriptionId: job.id }),
        )
      : [resolveImportDestination(options, name, empty)];
  });
}
