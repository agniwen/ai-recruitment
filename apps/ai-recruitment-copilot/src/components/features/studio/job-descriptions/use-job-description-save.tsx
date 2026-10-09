import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { JOB_DESCRIPTION_DUPLICATE_CODE } from "@arc/shared/job-descriptions";
import type { JobDescriptionFormValues } from "@arc/shared/job-descriptions";
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
import { ApiError } from "@/lib/client/api/errors";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";

function isDuplicateError(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    typeof error.payload === "object" &&
    error.payload !== null &&
    "code" in error.payload &&
    error.payload.code === JOB_DESCRIPTION_DUPLICATE_CODE
  );
}

export function useJobDescriptionSave({
  open,
  recordId,
  slug,
}: {
  open: boolean;
  recordId?: string;
  slug: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const session = useRef<object | null>(null);
  const saving = useRef<object | null>(null);

  useEffect(() => {
    session.current = open ? {} : null;
    setConfirming(false);
    return () => {
      session.current = null;
      saving.current = null;
      pending.current?.(false);
      pending.current = null;
    };
  }, [open, recordId, slug]);

  function resolveConfirmation(confirmed: boolean) {
    pending.current?.(confirmed);
    pending.current = null;
    setConfirming(false);
  }

  async function save(body: JobDescriptionFormValues): Promise<boolean> {
    const currentSession = session.current;
    if (!currentSession || saving.current) {
      return false;
    }
    saving.current = currentSession;
    const fallback = recordId ? "更新岗位失败" : "创建岗位失败";
    const submit = (forceSaveDuplicate?: boolean) => {
      const json = { ...body, forceSaveDuplicate };
      return rpcFetch(
        recordId
          ? rpc.api.w[":slug"].studio["job-descriptions"][":id"].$patch({
              json,
              param: { id: recordId, slug },
            })
          : rpc.api.w[":slug"].studio["job-descriptions"].$post({ json, param: { slug } }),
        fallback,
      );
    };
    try {
      try {
        await submit();
      } catch (error) {
        if (!isDuplicateError(error)) {
          throw error;
        }
        if (session.current !== currentSession) {
          return false;
        }
        setConfirming(true);
        // oxlint-disable-next-line promise/avoid-new -- resolves from the duplicate confirmation dialog.
        const confirmed = await new Promise<boolean>((resolve) => {
          pending.current = resolve;
        });
        if (!confirmed || session.current !== currentSession) {
          return false;
        }
        await submit(true);
      }
      return session.current === currentSession;
    } catch (error) {
      if (session.current === currentSession) {
        toast.error(error instanceof Error ? error.message : fallback);
      }
      return false;
    } finally {
      if (saving.current === currentSession) {
        saving.current = null;
      }
    }
  }

  const duplicateDialog = (
    <AlertDialog
      open={confirming}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resolveConfirmation(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>发现重复岗位</AlertDialogTitle>
          <AlertDialogDescription>
            已有记录的岗位、部门、服务单位、来源表格、需求发起人和简历对接人均与本次填写一致。
            你可以返回修改，也可以仍然保存。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>返回修改</AlertDialogCancel>
          <AlertDialogAction onClick={() => resolveConfirmation(true)}>仍然保存</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { duplicateDialog, save };
}
