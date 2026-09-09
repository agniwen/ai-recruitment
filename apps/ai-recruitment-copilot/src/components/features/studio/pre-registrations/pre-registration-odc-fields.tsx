import type { PreRegistrationOdcAssignment } from "@arc/db-schema/pre-registration";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function selectPreRegistrationOdcSources(
  current: PreRegistrationOdcAssignment[],
  sourceIds: string[],
): PreRegistrationOdcAssignment[] {
  return sourceIds.map(
    (resumeSourceId) =>
      current.find((item) => item.resumeSourceId === resumeSourceId) ?? {
        jobSeries: null,
        resumeSourceId,
        serviceUnit: null,
      },
  );
}

export function PreRegistrationOdcFields({
  assignments,
  sources,
  disabled,
  loading,
  failed,
  onChange,
}: {
  assignments: PreRegistrationOdcAssignment[];
  sources: { id: string; name: string }[];
  disabled: boolean;
  loading: boolean;
  failed: boolean;
  onChange: (assignments: PreRegistrationOdcAssignment[]) => void;
}) {
  const options = sources.map((source) => ({ label: source.name, value: source.id }));
  for (const assignment of assignments) {
    if (!sources.some((source) => source.id === assignment.resumeSourceId)) {
      options.push({ label: "来源已不可用，请移除", value: assignment.resumeSourceId });
    }
  }
  function update(resumeSourceId: string, patch: Partial<PreRegistrationOdcAssignment>) {
    onChange(
      assignments.map((assignment) =>
        assignment.resumeSourceId === resumeSourceId ? { ...assignment, ...patch } : assignment,
      ),
    );
  }
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="pre-registration-odc-sources">负责部门/中心（来源）</FieldLabel>
        <SearchableMultiSelect
          id="pre-registration-odc-sources"
          disabled={disabled || loading || failed}
          options={options}
          value={assignments.map((assignment) => assignment.resumeSourceId)}
          onChange={(ids) => onChange(selectPreRegistrationOdcSources(assignments, ids))}
          placeholder={loading ? "加载部门/中心（来源）中…" : "请选择部门/中心（来源）（可多选）"}
          searchPlaceholder="搜索部门/中心（来源）"
          emptyMessage="暂无可选部门/中心（来源）"
        />
        <FieldDescription>可分别设置每个来源的负责范围，留空表示不限。</FieldDescription>
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            部门/中心（来源）加载失败，请重新打开表单重试。
          </p>
        ) : null}
      </Field>
      {assignments.map((assignment) => {
        const prefix = `pre-registration-odc-${assignment.resumeSourceId}`;
        return (
          <FieldGroup key={assignment.resumeSourceId} className="gap-3 rounded-md border p-3">
            <p className="text-sm font-medium">
              {sources.find((source) => source.id === assignment.resumeSourceId)?.name ??
                "来源已不可用"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${prefix}-series`}>序列（非必填）</FieldLabel>
                <Select
                  disabled={disabled}
                  value={assignment.jobSeries ?? "all"}
                  onValueChange={(value) => {
                    if (value === "all" || value === "直属" || value === "派驻") {
                      update(assignment.resumeSourceId, {
                        jobSeries: value === "all" ? null : value,
                      });
                    }
                  }}
                >
                  <SelectTrigger id={`${prefix}-series`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">不限序列</SelectItem>
                      <SelectItem value="直属">直属</SelectItem>
                      <SelectItem value="派驻">派驻</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}-unit`}>服务单位（非必填）</FieldLabel>
                <Input
                  id={`${prefix}-unit`}
                  disabled={disabled}
                  maxLength={120}
                  value={assignment.serviceUnit ?? ""}
                  placeholder="留空表示不限服务单位"
                  onChange={(event) =>
                    update(assignment.resumeSourceId, { serviceUnit: event.target.value })
                  }
                />
              </Field>
            </div>
          </FieldGroup>
        );
      })}
    </FieldGroup>
  );
}
