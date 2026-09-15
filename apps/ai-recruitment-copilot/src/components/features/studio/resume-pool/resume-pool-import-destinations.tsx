import type { ResumePoolImportDestination, ResumePoolImportOptions } from "@arc/shared/resume-pool";
import { Field, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import {
  emptyImportDestination,
  matchingImportJobs,
  resolveImportDestination,
} from "./resume-pool-import-selection";

export function ResumePoolImportDestinations({
  options,
  jobName,
  destinations,
  onChange,
  disabled,
  multipleJobs = false,
}: {
  options: ResumePoolImportOptions;
  jobName: string;
  destinations: ResumePoolImportDestination[];
  onChange: (rows: ResumePoolImportDestination[]) => void;
  disabled: boolean;
  multipleJobs?: boolean;
}) {
  const hiringUnitIds = [...new Set(destinations.map((row) => row.hiringUnitId))];
  const units = options.hiringUnits.filter(
    (unit) =>
      !jobName ||
      options.jobDescriptions.some(
        (job) => job.hiringUnitId === unit.id && job.name.trim() === jobName,
      ),
  );
  const unitOptions = units.map((unit) => {
    const departmentNames = jobName
      ? options.jobDescriptions
          .filter((job) => job.hiringUnitId === unit.id && job.name.trim() === jobName)
          .map(
            (job) =>
              job.departmentName ||
              options.departments.find((dept) => dept.id === job.departmentId)?.name,
          )
      : options.departments
          .filter((dept) => dept.hiringUnitId === unit.id)
          .map((dept) => dept.name);
    const departmentsLabel = [...new Set(departmentNames.filter(Boolean))].join("、");
    return {
      label: departmentsLabel ? `${unit.name} / ${departmentsLabel}` : unit.name,
      value: unit.id,
    };
  });
  const changeRow = (index: number, patch: Partial<ResumePoolImportDestination>) =>
    onChange(
      destinations.map((row, i) =>
        i === index
          ? resolveImportDestination(options, jobName, {
              ...row,
              ...patch,
              jobDescriptionId: patch.jobDescriptionId ?? null,
            })
          : row,
      ),
    );
  const changeJobs = (hiringUnitId: string, jobIds: string[]) =>
    onChange(
      hiringUnitIds.flatMap((id) => {
        if (id !== hiringUnitId) {
          return destinations.filter((row) => row.hiringUnitId === id);
        }
        const empty = emptyImportDestination(id);
        return jobIds.length > 0
          ? jobIds.map((jobDescriptionId) =>
              resolveImportDestination(options, jobName, { ...empty, jobDescriptionId }),
            )
          : [empty];
      }),
    );
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="resume-pool-import-hiring-unit">入库组织（可多选）</FieldLabel>
        <SearchableMultiSelect
          id="resume-pool-import-hiring-unit"
          disabled={disabled}
          value={hiringUnitIds}
          options={unitOptions}
          searchPlaceholder="搜索组织或部门..."
          placeholder="请选择入库组织"
          onChange={(ids) =>
            onChange(
              ids.flatMap((id) => {
                const existing = destinations.filter((row) => row.hiringUnitId === id);
                return existing.length > 0
                  ? existing
                  : [resolveImportDestination(options, jobName, emptyImportDestination(id))];
              }),
            )
          }
        />
        <p className="text-xs text-muted-foreground">
          {multipleJobs
            ? "可先选岗位或组织，选项会相互筛选。每个组织可选择多个同名岗位去向，每份简历按选中的具体去向分别创建候选人记录。"
            : "可先选岗位或组织，选项会相互筛选。每个所选组织分别创建一条候选人记录，绑定该组织对应的具体岗位。"}
        </p>
      </Field>
      {hiringUnitIds.map((hiringUnitId, index) => {
        const organizationRows = destinations.filter((row) => row.hiringUnitId === hiringUnitId);
        const [destination] = organizationRows;
        const matches = matchingImportJobs(options, jobName, destination);
        const selectedIds = organizationRows.flatMap((row) =>
          row.jobDescriptionId ? [row.jobDescriptionId] : [],
        );
        const selectedJobs = matches.filter((job) => selectedIds.includes(job.id));
        const jobOptions = matches.map((job) => ({
          label: [job.departmentName, job.serviceUnit, job.resumeSourceName, job.code || job.id]
            .filter(Boolean)
            .join(" / "),
          value: job.id,
        }));
        return (
          <section
            className="rounded-lg border p-4"
            key={destination.hiringUnitId}
            aria-label={unitOptions.find((unit) => unit.value === destination.hiringUnitId)?.label}
          >
            <p className="mb-3 text-sm font-medium">
              {unitOptions.find((unit) => unit.value === destination.hiringUnitId)?.label}
            </p>
            {jobName && matches.length > 1 ? (
              <Field className="mt-3">
                <FieldLabel htmlFor={`import-job-${index}`}>
                  {multipleJobs ? "具体岗位去向（可多选）" : "具体岗位去向"}
                </FieldLabel>
                {multipleJobs ? (
                  <SearchableMultiSelect
                    id={`import-job-${index}`}
                    disabled={disabled}
                    value={selectedIds}
                    options={jobOptions}
                    placeholder="请选择具体去向（可多选）"
                    searchPlaceholder="搜索部门、服务单位或需求编号..."
                    onChange={(jobIds) => changeJobs(hiringUnitId, jobIds)}
                  />
                ) : (
                  <SearchableSelect
                    id={`import-job-${index}`}
                    disabled={disabled}
                    value={destination.jobDescriptionId}
                    placeholder="请选择具体去向"
                    options={jobOptions}
                    onChange={(jobDescriptionId) => changeRow(index, { jobDescriptionId })}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {multipleJobs
                    ? "请选择至少一个去向；每个选中的去向分别进入招聘流程。"
                    : "同名岗位有多个去向，请确认要推荐到哪一个。"}
                </p>
              </Field>
            ) : null}
            {selectedJobs.map((selectedJob) => (
              <p className="mt-3 text-xs text-muted-foreground" key={selectedJob.id}>
                推荐至：
                {selectedJob.name}；部门：{selectedJob.departmentName || "未设置"}；服务单位：
                {selectedJob.serviceUnit || "未设置"}
              </p>
            ))}
          </section>
        );
      })}
    </div>
  );
}
