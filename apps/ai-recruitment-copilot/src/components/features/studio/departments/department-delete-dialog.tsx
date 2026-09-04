import { EntityDeleteDialog } from "@/components/features/studio/entity-delete-dialog";

interface DepartmentDeleteRecord {
  interviewerCount: number;
  jobDescriptionCount: number;
  name: string;
}

interface DepartmentDeleteDialogProps<TRecord extends DepartmentDeleteRecord> {
  onClose: () => void;
  onConfirm: () => void;
  record: TRecord | null;
}

export function DepartmentDeleteDialog<TRecord extends DepartmentDeleteRecord>({
  onClose,
  onConfirm,
  record,
}: DepartmentDeleteDialogProps<TRecord>) {
  return (
    <EntityDeleteDialog
      confirmDisabled={(department) =>
        department.interviewerCount > 0 || department.jobDescriptionCount > 0
      }
      description={(department) =>
        department.interviewerCount > 0 || department.jobDescriptionCount > 0
          ? "该部门下仍有面试官或在招岗位，将无法删除。"
          : `即将删除部门：${department.name}，删除后无法恢复。`
      }
      onClose={onClose}
      onConfirm={onConfirm}
      record={record}
      title="确认删除这个部门？"
    />
  );
}
