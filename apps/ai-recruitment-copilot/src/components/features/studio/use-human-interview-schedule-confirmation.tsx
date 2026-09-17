"use client";

import { useEffect, useRef, useState } from "react";
import type {
  HumanInterviewConflict,
  HumanInterviewConflictInput,
} from "@arc/shared/human-interview-conflicts";
import { checkHumanInterviewConflicts } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
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
import { formatDateTime } from "./human-interview-stage-utils";

export function useHumanInterviewScheduleConfirmation() {
  const slug = useWorkspaceSlug();
  const [conflicts, setConflicts] = useState<HumanInterviewConflict[]>([]);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const mounted = useRef(false);
  const checking = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.(false);
      pending.current = null;
    };
  }, []);

  function resolveConfirmation(confirmed: boolean) {
    pending.current?.(confirmed);
    pending.current = null;
    setConflicts([]);
  }

  async function confirmSchedule(input: HumanInterviewConflictInput): Promise<boolean> {
    if (checking.current) {
      return false;
    }
    checking.current = true;
    try {
      const result = await checkHumanInterviewConflicts(slug, input);
      if (!mounted.current) {
        return false;
      }
      if (result.conflicts.length === 0) {
        return true;
      }
      setConflicts(result.conflicts);
      // oxlint-disable-next-line promise/avoid-new -- resolves from the user's dialog action.
      return await new Promise<boolean>((resolve) => {
        pending.current = resolve;
      });
    } finally {
      checking.current = false;
    }
  }

  const conflictDialog = (
    <AlertDialog
      open={conflicts.length > 0}
      onOpenChange={(open) => {
        if (!open) {
          resolveConfirmation(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>面试官日程冲突</AlertDialogTitle>
          <AlertDialogDescription>
            以下面试官已有真人面试安排，与本次时间重叠。你可以继续创建，或取消后修改时间。时间均为北京时间。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto">
          {conflicts.map((conflict) => (
            <li key={`${conflict.interviewerId}:${conflict.startAt}:${conflict.endAt}`}>
              <p className="font-medium text-sm">{conflict.interviewerName}</p>
              <p className="text-muted-foreground text-sm">
                {formatDateTime(conflict.startAt)} ～ {formatDateTime(conflict.endAt)}
              </p>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>取消，修改时间</AlertDialogCancel>
          <AlertDialogAction onClick={() => resolveConfirmation(true)}>继续创建</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmSchedule, conflictDialog };
}
