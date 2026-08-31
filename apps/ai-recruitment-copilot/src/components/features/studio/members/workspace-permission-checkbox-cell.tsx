import { Checkbox } from "@/components/ui/checkbox";
import type { PermissionItem } from "./workspace-role-permissions";

function BooleanRoleCell({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle?: () => void;
}) {
  return (
    <div
      className="flex min-h-10 cursor-default items-center justify-center px-2 py-1.5 text-center"
      title={label}
    >
      <Checkbox
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onToggle?.()}
      />
    </div>
  );
}

export function PermissionCell({
  checked,
  disabled,
  item,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  item: PermissionItem;
  onToggle?: () => void;
}) {
  return (
    <BooleanRoleCell
      checked={checked}
      disabled={disabled}
      label={`${item.label}: ${checked ? "允许" : "不允许"}`}
      onToggle={onToggle}
    />
  );
}

export function OdcRoleCell({
  checked,
  disabled,
  name,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  name: string;
  onToggle?: () => void;
}) {
  return (
    <BooleanRoleCell
      checked={checked}
      disabled={disabled}
      label={`${name}: ${checked ? "计入 ODC 分析" : "不计入 ODC 分析"}`}
      onToggle={onToggle}
    />
  );
}
