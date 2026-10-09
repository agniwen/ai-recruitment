"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EntityDeleteDialogProps<TRecord> {
  /** 当前待删除记录；为 null 时弹窗关闭。 */
  record: TRecord | null;
  /** 关闭弹窗（hook 通常传 `() => setDeleteRecord(null)`）。 */
  onClose: () => void;
  /** 用户确认删除时触发；通常透传 hook 返回的 `handleDelete`。 */
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  /**
   * 描述：可以是静态 ReactNode，也可以根据 record 动态渲染（用于
   * "已被引用，无法删除"等条件文案）。
   *
   * Description: static node, or a fn for record-dependent copy
   * (e.g. "still referenced, cannot delete").
   */
  description: ReactNode | ((record: TRecord) => ReactNode);
  /** 默认"删除"。 */
  confirmLabel?: ReactNode;
  /** 默认"取消"。 */
  cancelLabel?: ReactNode;
  /**
   * 是否禁用"删除"按钮。可以是静态布尔，也可以根据 record 动态判断
   * （比如"还有关联数据时不可删"）。
   *
   * Disables the confirm button. Static boolean or record-dependent fn
   * (e.g. "still has dependents, cannot delete").
   */
  confirmDisabled?: boolean | ((record: TRecord) => boolean);
  /** 删除请求进行中：展示进度，禁止重复提交和关闭弹窗。 */
  isPending?: boolean;
}

/**
 * 统一的"删除前确认"弹窗。description 支持函数式以便引用记录字段。
 * Shared confirm-before-delete dialog. `description` accepts a function
 * for record-dependent copy.
 */
export function EntityDeleteDialog<TRecord>({
  record,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "删除",
  cancelLabel = "取消",
  confirmDisabled = false,
  isPending = false,
}: EntityDeleteDialogProps<TRecord>) {
  let resolvedDescription: ReactNode = null;
  let resolvedDisabled = false;
  if (record !== null) {
    resolvedDescription =
      typeof description === "function"
        ? (description as (r: TRecord) => ReactNode)(record)
        : description;
    resolvedDisabled =
      typeof confirmDisabled === "function"
        ? (confirmDisabled as (r: TRecord) => boolean)(record)
        : confirmDisabled;
  }

  return (
    <AlertDialog
      onOpenChange={(open, details) => {
        if (isPending) {
          details.cancel();
          return;
        }
        if (!open) {
          onClose();
        }
      }}
      open={record !== null}
    >
      <AlertDialogContent aria-busy={isPending}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{resolvedDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={resolvedDisabled || isPending}
            onClick={() => void onConfirm()}
            variant="destructive"
          >
            {isPending ? <Spinner aria-label="正在删除" data-icon="inline-start" /> : null}
            {isPending ? "删除中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
