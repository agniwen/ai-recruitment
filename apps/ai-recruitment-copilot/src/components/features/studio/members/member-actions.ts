import type { ActionMenuItem } from "@/components/data-grid/columns/actions-column";
import type { MemberRow } from "./members-page-model";

export function buildMemberActionMenu({
  canDelete,
  canUpdate,
  onEditProfile,
  onRemove,
  onEditOdcScope,
  canEditOdcScope,
}: {
  canDelete: boolean;
  canUpdate: boolean;
  onEditProfile: (member: MemberRow) => void;
  onRemove: (member: MemberRow) => void;
  onEditOdcScope?: (member: MemberRow) => void;
  canEditOdcScope?: (member: MemberRow) => boolean;
}): ActionMenuItem<MemberRow>[] {
  return [
    ...(onEditOdcScope
      ? [
          {
            label: "设置 ODC 负责范围",
            onClick: onEditOdcScope,
            show: (row: MemberRow) => canEditOdcScope?.(row) ?? false,
          },
        ]
      : []),
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
