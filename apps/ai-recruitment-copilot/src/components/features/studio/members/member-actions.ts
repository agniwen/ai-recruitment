import type { ActionMenuItem } from "@/components/data-grid/columns/actions-column";
import type { MemberRow } from "./members-page-model";

export function buildMemberActionMenu({
  canDelete,
  canUpdate,
  onEditName,
  onRemove,
}: {
  canDelete: boolean;
  canUpdate: boolean;
  onEditName: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
}): ActionMenuItem<MemberRow>[] {
  return [
    {
      label: "修改用户名称",
      onClick: onEditName,
      show: () => canUpdate,
    },
    {
      label: "移除成员",
      onClick: onRemove,
      separator: "before",
      show: () => canDelete,
      variant: "destructive",
    },
  ];
}
