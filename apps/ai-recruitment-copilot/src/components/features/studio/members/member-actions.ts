import type { ActionMenuItem } from "@/components/data-grid/columns/actions-column";
import type { MemberRow } from "./members-page-model";

export function buildMemberActionMenu({
  canDelete,
  canUpdate,
  onEditProfile,
  onRemove,
}: {
  canDelete: boolean;
  canUpdate: boolean;
  onEditProfile: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
}): ActionMenuItem<MemberRow>[] {
  return [
    {
      label: "编辑成员资料",
      onClick: onEditProfile,
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
