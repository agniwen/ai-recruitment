import type { ResumePoolImportOptions } from "@arc/shared/resume-pool";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import {
  bulkUploadSelectionModel,
  changeBulkUploadSelection,
  toggleBulkUploadDestination,
} from "./bulk-upload-selection";
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
  const { jobOptions, unitOptions, availableDestinations, destinations } = bulkUploadSelectionModel(
    options,
    selection,
  );
  const unmatchedJobNames =
    selection.hiringUnitIds.length > 0
      ? selection.jobNames.filter(
          (name) => !availableDestinations.some((job) => job.name.trim() === name),
        )
      : [];
  const unmatchedUnits =
    selection.jobNames.length > 0
      ? unitOptions.filter(
          (unit) =>
            selection.hiringUnitIds.includes(unit.value) &&
            !availableDestinations.some((job) => job.hiringUnitId === unit.value),
        )
      : [];
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
          onChange={(values) => onChange(changeBulkUploadSelection(selection, "jobNames", values))}
        />
      </div>
      <div className="space-y-3">
        <Label htmlFor="resume-pool-import-hiring-unit">入库组织（可多选）</Label>
        <SearchableMultiSelect
          id="resume-pool-import-hiring-unit"
          triggerClassName="min-w-0 [&_[data-slot=combobox-chip]]:h-auto [&_[data-slot=combobox-chip]]:max-w-full [&_[data-slot=combobox-chip]]:whitespace-normal [&_[data-slot=combobox-chip]]:wrap-anywhere"
          value={selection.hiringUnitIds}
          options={unitOptions}
          placeholder="请选择入库组织"
          searchPlaceholder="搜索组织或部门..."
          disabled={disabled}
          onChange={(values) =>
            onChange(changeBulkUploadSelection(selection, "hiringUnitIds", values))
          }
        />
        <p className="text-xs text-muted-foreground">
          岗位和组织可多选，选项按另一侧任一已选项筛选，已选内容始终保留。下方每个勾选的具体去向，为每份简历生成一条记录。
        </p>
      </div>
      {unmatchedJobNames.length > 0 || unmatchedUnits.length > 0 ? (
        <output
          aria-label="入库匹配提示"
          className="block space-y-1 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        >
          {unmatchedJobNames.length > 0 ? (
            <span className="block">
              以下岗位在已选组织中暂无匹配去向：{unmatchedJobNames.join("、")}。可继续补选对应组织。
            </span>
          ) : null}
          {unmatchedUnits.length > 0 ? (
            <span className="block">
              以下组织与已选岗位暂无匹配去向：{unmatchedUnits.map((unit) => unit.label).join("、")}
              。可继续补选对应岗位。
            </span>
          ) : null}
          <span className="block">已保留上述选择；入库时仅使用下方勾选的有效去向。</span>
        </output>
      ) : null}
      {destinations.length > 0 ? (
        <p className="text-sm font-medium" aria-live="polite">
          入库去向：每份简历生成 {destinations.length} 条记录
        </p>
      ) : null}
      {unitOptions.map((unit) => {
        const jobs = availableDestinations.filter((job) => job.hiringUnitId === unit.value);
        if (jobs.length === 0) {
          return null;
        }
        return (
          <section className="rounded-lg border p-4" key={unit.value} aria-label={unit.label}>
            <p className="text-sm font-medium">{unit.label}</p>
            {jobs.map((job) => (
              <label
                className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground"
                key={job.id}
                data-destination-id={job.id}
              >
                <Checkbox
                  aria-label={`入库去向：${job.name}，${job.departmentName || "未设置"}，${job.code || job.id}`}
                  checked={destinations.some((selected) => selected.id === job.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(toggleBulkUploadDestination(selection, job.id, checked === true))
                  }
                />
                <span>
                  推荐至：{job.name}；部门：{job.departmentName || "未设置"}；服务单位：
                  {job.serviceUnit || "未设置"}；需求编号：{job.code || job.id}
                </span>
              </label>
            ))}
          </section>
        );
      })}
    </div>
  );
}
