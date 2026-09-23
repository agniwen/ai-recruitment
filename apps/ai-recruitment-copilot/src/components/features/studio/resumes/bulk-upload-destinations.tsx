import type { ResumePoolImportOptions } from "@arc/shared/resume-pool";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { bulkUploadSelectionModel, changeBulkUploadSelection } from "./bulk-upload-selection";
import type { BulkUploadSelection } from "./bulk-upload-selection";

export function BulkUploadDestinations({
  options,
  selection,
  onChange,
  disabled,
}: {
  options: ResumePoolImportOptions;
  selection: BulkUploadSelection;
  onChange: (selection: BulkUploadSelection) => void;
  disabled: boolean;
}) {
  const { jobOptions, unitOptions, destinations } = bulkUploadSelectionModel(options, selection);
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        <Label htmlFor="candidate-import-job">在招岗位（必选，可多选）</Label>
        <SearchableMultiSelect
          id="candidate-import-job"
          value={selection.jobNames}
          options={jobOptions}
          placeholder="请选择在招岗位"
          searchPlaceholder="搜索岗位名称..."
          disabled={disabled}
          onChange={(values) =>
            onChange(changeBulkUploadSelection(options, selection, "jobNames", values))
          }
        />
      </div>
      <div className="space-y-3">
        <Label htmlFor="resume-pool-import-hiring-unit">入库组织（可多选）</Label>
        <SearchableMultiSelect
          id="resume-pool-import-hiring-unit"
          value={selection.hiringUnitIds}
          options={unitOptions}
          placeholder="请选择入库组织"
          searchPlaceholder="搜索组织或部门..."
          disabled={disabled}
          onChange={(values) =>
            onChange(changeBulkUploadSelection(options, selection, "hiringUnitIds", values))
          }
        />
        <p className="text-xs text-muted-foreground">
          可先选岗位或组织，选项会相互筛选。下方每个具体岗位去向，为每份简历生成一条记录。
        </p>
      </div>
      {destinations.length > 0 ? (
        <p className="text-sm font-medium" aria-live="polite">
          入库去向：每份简历生成 {destinations.length} 条记录
        </p>
      ) : null}
      {unitOptions.map((unit) => {
        const jobs = destinations.filter((job) => job.hiringUnitId === unit.value);
        if (jobs.length === 0) {
          return null;
        }
        return (
          <section className="rounded-lg border p-4" key={unit.value} aria-label={unit.label}>
            <p className="text-sm font-medium">{unit.label}</p>
            {jobs.map((job) => (
              <p
                className="mt-3 text-xs text-muted-foreground"
                key={job.id}
                data-destination-id={job.id}
              >
                推荐至：{job.name}；部门：{job.departmentName || "未设置"}；服务单位：
                {job.serviceUnit || "未设置"}；需求编号：{job.code || job.id}
              </p>
            ))}
          </section>
        );
      })}
    </div>
  );
}
