import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";

export interface SscResponsibilityScope {
  serviceUnit: string | null;
  departmentId: string | null;
}

export interface SscResponsibilityScopeOptions {
  departments: { id: string; name: string; hiringUnitName: string | null }[];
  serviceUnits: string[];
}

function departmentDescription(
  department: SscResponsibilityScopeOptions["departments"][number],
  departments: SscResponsibilityScopeOptions["departments"],
) {
  const matching = departments.filter(
    (item) => item.name === department.name && item.hiringUnitName === department.hiringUnitName,
  );
  if (matching.length < 2) {
    return department.hiringUnitName ?? undefined;
  }
  const shortId = department.id.slice(0, 8);
  const collision = matching.some(
    (item) => item.id !== department.id && item.id.slice(0, 8) === shortId,
  );
  const identifier = collision ? department.id : shortId;
  return [department.hiringUnitName, `部门ID：${identifier}`].filter(Boolean).join(" · ");
}

export function SscScopeFields({
  value,
  options,
  disabled,
  idPrefix = "ssc",
  onChange,
}: {
  value: SscResponsibilityScope;
  options: SscResponsibilityScopeOptions | undefined;
  disabled: boolean;
  idPrefix?: string;
  onChange: (value: SscResponsibilityScope) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-serviceUnit`}>
          服务单位 <span className="font-normal text-xs text-muted-foreground">留空不限</span>
        </Label>
        <Input
          id={`${idPrefix}-serviceUnit`}
          list={`${idPrefix}-serviceUnits`}
          value={value.serviceUnit ?? ""}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, serviceUnit: event.target.value || null })}
        />
        <datalist id={`${idPrefix}-serviceUnits`}>
          {(options?.serviceUnits ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </datalist>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-departmentId`}>
          部门 <span className="font-normal text-xs text-muted-foreground">留空不限</span>
        </Label>
        <SearchableSelect
          id={`${idPrefix}-departmentId`}
          value={value.departmentId}
          options={(options?.departments ?? []).map((department) => ({
            description: departmentDescription(department, options?.departments ?? []),
            label: department.name,
            value: department.id,
          }))}
          disabled={disabled}
          clearable
          placeholder=""
          searchPlaceholder="搜索部门或入职编制组织"
          emptyMessage="暂无匹配的部门"
          onChange={(departmentId) => onChange({ ...value, departmentId })}
        />
      </div>
    </>
  );
}
