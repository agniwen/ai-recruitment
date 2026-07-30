"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { EntityDeleteDialog } from "./entity-delete-dialog";

type TemplateRefreshKind = "candidate_form" | "interview_question";

interface TemplateRefreshRecord {
  id: string;
  title: string;
}

interface TemplateRefreshResult {
  refreshedCount: number;
  scannedCount: number;
}

const refreshCopy = {
  candidate_form: {
    description: (title: string) =>
      `将把「${title}」的最新表单推送到所有适用、尚未填写且未开始 AI 面试的候选人。已填写或已开始面试的候选人不会改动。`,
    empty: (scannedCount: number) => `扫描 ${scannedCount} 人，没有需要更新的未填写候选人`,
    loading: "正在刷新未填写候选人表单题…",
    success: (refreshedCount: number, scannedCount: number) =>
      `已刷新 ${refreshedCount} 位未填写候选人（扫描 ${scannedCount} 人）`,
    title: "确认刷新未填写候选人表单题？",
  },
  interview_question: {
    description: (title: string) =>
      `将把「${title}」的最新题目推送到所有适用且尚未开始 AI 面试的候选人。已开始或已完成面试的候选人不会改动。`,
    empty: (scannedCount: number) => `扫描 ${scannedCount} 人，没有需要更新的未面试候选人`,
    loading: "正在刷新未面试候选人沟通题…",
    success: (refreshedCount: number, scannedCount: number) =>
      `已刷新 ${refreshedCount} 位未面试候选人（扫描 ${scannedCount} 人）`,
    title: "确认刷新未面试候选人沟通题？",
  },
} as const;

function refreshEligibleCandidates(
  kind: TemplateRefreshKind,
  slug: string,
  recordId: string,
): Promise<TemplateRefreshResult> {
  if (kind === "candidate_form") {
    return rpcFetch<TemplateRefreshResult>(
      rpc.api.w[":slug"].studio.forms[":id"]["refresh-eligible-candidates"].$post({
        param: { id: recordId, slug },
      }),
      "刷新失败",
    );
  }
  return rpcFetch<TemplateRefreshResult>(
    rpc.api.w[":slug"].studio["interview-questions"][":id"]["refresh-eligible-candidates"].$post({
      param: { id: recordId, slug },
    }),
    "刷新失败",
  );
}

export function useTemplateRefreshDialog({
  canRefresh,
  kind,
  slug,
}: {
  canRefresh: boolean;
  kind: TemplateRefreshKind;
  slug: string;
}) {
  const [record, setRecord] = useState<TemplateRefreshRecord | null>(null);
  const pendingRecordRef = useRef<TemplateRefreshRecord | null>(null);
  const copy = refreshCopy[kind];

  const open = useCallback((nextRecord: TemplateRefreshRecord) => {
    pendingRecordRef.current = nextRecord;
    setRecord(nextRecord);
  }, []);

  const confirm = useCallback(async () => {
    const target = pendingRecordRef.current ?? record;
    pendingRecordRef.current = null;
    setRecord(null);
    if (!target) {
      return;
    }

    const toastId = toast.loading(copy.loading);
    try {
      const result = await refreshEligibleCandidates(kind, slug, target.id);
      toast.success(
        result.refreshedCount === 0
          ? copy.empty(result.scannedCount)
          : copy.success(result.refreshedCount, result.scannedCount),
        { id: toastId },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "刷新失败", { id: toastId });
    }
  }, [copy, kind, record, slug]);

  return {
    dialog: (
      <EntityDeleteDialog
        cancelLabel="取消"
        confirmLabel="确认刷新"
        description={(target) => copy.description(target.title)}
        onClose={() => setRecord(null)}
        onConfirm={confirm}
        record={canRefresh ? record : null}
        title={copy.title}
      />
    ),
    open,
  };
}
