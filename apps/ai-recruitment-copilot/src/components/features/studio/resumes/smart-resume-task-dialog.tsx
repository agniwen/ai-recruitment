"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { isSmartResumeTaskSourceComplete } from "@arc/shared/smart-resume-upload";
import type {
  SmartResumeTaskDto,
  SmartResumeTaskItemDto,
  SmartResumeTaskSource,
} from "@arc/shared/smart-resume-upload";
import type { PortfolioItem, ResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import { uploadPortfolioForBulk } from "@/lib/client/api/endpoints/bulk-resume-upload";
import {
  getSmartResumeTask,
  retrySmartResumeTask,
  saveSmartResumeTaskDraft,
  submitSmartResumeTask,
} from "@/lib/client/api/endpoints/smart-resume-upload";
import { ResumeRecruitmentSourceFields } from "./resume-recruitment-source-fields";
import { SmartResumeTaskItem } from "./smart-resume-task-item";

function canSubmitTask(task: SmartResumeTaskDto) {
  return (
    !task.submittedAt &&
    (task.items.every((item) => item.skipped) || isSmartResumeTaskSourceComplete(task)) &&
    task.items.every(
      (item) =>
        item.status !== "pending" &&
        item.status !== "processing" &&
        (item.skipped || item.selectedJobIds.length > 0),
    )
  );
}

function taskSourceState(
  task: SmartResumeTaskSource | undefined,
  draft: SmartResumeTaskSource | null,
) {
  const current = draft ?? task ?? { recruitmentSource: null, recruitmentSourceDetail: null };
  const source = {
    recruitmentSource: current.recruitmentSource,
    recruitmentSourceDetail: current.recruitmentSourceDetail,
  };
  const normalizedSource = {
    recruitmentSource: source.recruitmentSource,
    recruitmentSourceDetail: source.recruitmentSourceDetail?.trim() || null,
  };
  const sourceDirty = Boolean(
    draft &&
    (normalizedSource.recruitmentSource !== task?.recruitmentSource ||
      normalizedSource.recruitmentSourceDetail !== task?.recruitmentSourceDetail),
  );
  return { normalizedSource, source, sourceDirty };
}

function SmartResumeTaskSourceFields({
  id,
  source,
  dirty,
  saving,
  disabled,
  onSourceChange,
  onDetailChange,
  onSave,
}: {
  id: string;
  source: SmartResumeTaskSource;
  dirty: boolean;
  saving: boolean;
  disabled: boolean;
  onSourceChange: (value: ResumeRecruitmentSource) => void;
  onDetailChange: (value: string) => void;
  onSave: () => void;
}) {
  let hint = "本任务的简历共用此来源，可在提交前补填或修改。";
  if (saving) {
    hint = "正在保存来源…";
  } else if (dirty) {
    hint = "来源已修改，提交或稍后处理时会一并保存。";
  }
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="任务简历来源">
      <ResumeRecruitmentSourceFields
        idPrefix={`smart-task-${id}`}
        source={source.recruitmentSource ?? ""}
        detail={source.recruitmentSourceDetail ?? ""}
        disabled={disabled}
        onSourceChange={onSourceChange}
        onDetailChange={onDetailChange}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {hint}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !dirty}
          onClick={onSave}
        >
          保存来源
        </Button>
      </div>
    </section>
  );
}

export function SmartResumeTaskDialog({
  slug,
  id,
  onClose,
  onSubmitted,
}: {
  slug: string;
  id: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const client = useQueryClient();
  const [sourceDraft, setSourceDraft] = useState<SmartResumeTaskSource | null>(null);
  const key = ["smart-resume-tasks", slug, id];
  const detail = useQuery({
    queryFn: () => getSmartResumeTask(slug, id),
    queryKey: key,
    refetchInterval: (query) =>
      query.state.data?.task.items.some(
        (item) => item.status === "pending" || item.status === "processing",
      )
        ? 4000
        : false,
    staleTime: 0,
  });
  const { data } = detail;
  const { source, normalizedSource, sourceDirty } = taskSourceState(data?.task, sourceDraft);
  const refresh = () => client.invalidateQueries({ queryKey: ["smart-resume-tasks", slug] });
  const sourceSave = useMutation({
    mutationFn: () => saveSmartResumeTaskDraft(slug, id, normalizedSource),
    onSuccess: refresh,
  });
  const selection = useMutation({
    mutationFn: (item: { itemId: string; jobDescriptionIds: string[]; skipped: boolean }) =>
      saveSmartResumeTaskDraft(slug, id, { items: [item] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存选择失败"),
    onSuccess: refresh,
  });
  const portfolio = useMutation({
    mutationFn: async ({
      itemId,
      attachments,
      files = [],
    }: {
      itemId: string;
      attachments: PortfolioItem[];
      files?: File[];
    }) => {
      const saved = [...attachments];
      for (const file of files) {
        const uploaded = await uploadPortfolioForBulk(slug, file);
        saved.push(uploaded);
        // Persist each successful file so another file's failure does not lose it.
        await saveSmartResumeTaskDraft(slug, id, {
          items: [{ itemId, portfolioAttachments: saved }],
        });
      }
      if (!files.length) {
        await saveSmartResumeTaskDraft(slug, id, {
          items: [{ itemId, portfolioAttachments: saved }],
        });
      }
    },
    onSettled: refresh,
  });
  const retry = useMutation({
    mutationFn: () => retrySmartResumeTask(slug, id),
    onError: (error) => toast.error(error.message),
    onSuccess: refresh,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (sourceDirty) {
        await sourceSave.mutateAsync();
      }
      return submitSmartResumeTask(slug, id);
    },
    onError: (error) => toast.error(error.message),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        result.recordIds.length ? `已提交 ${result.recordIds.length} 条岗位去向` : "任务已完成",
      );
      onSubmitted();
      onClose();
    },
  });
  const busy = [selection, submit, retry, sourceSave, portfolio].some(
    (mutation) => mutation.isPending,
  );
  const running = data?.task.items.some(
    (item) => item.status === "pending" || item.status === "processing",
  );
  const complete =
    data?.task.items.filter((item) => item.status === "ready" || item.status === "failed").length ??
    0;
  const canSubmit = data ? canSubmitTask({ ...data.task, ...source }) : false;
  const close = () => {
    if (busy) {
      return;
    }
    if (sourceDirty) {
      sourceSave.mutate(undefined, {
        onError: (error) => toast.error(error.message),
        onSuccess: onClose,
      });
    } else {
      onClose();
    }
  };
  const choose = (
    item: SmartResumeTaskItemDto,
    jobDescriptionIds: string[],
    skipped = item.skipped,
  ) => {
    if (jobDescriptionIds.length > 10) {
      toast.error("每份简历最多选择 10 个岗位");
      return;
    }
    selection.mutate({ itemId: item.id, jobDescriptionIds, skipped });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      dismissible={!busy}
      title="智能上传任务"
      size="xl"
      description="分析会在后台继续。确认每份简历的岗位去向后提交；选择会自动保存，可稍后继续。"
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            稍后处理
          </Button>
          <div className="flex gap-2">
            {data?.task.items.some(
              (item) => item.status === "failed" || item.status === "pending",
            ) ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => retry.mutate()}
              >
                {retry.isPending ? "正在重试…" : "重试未完成项"}
              </Button>
            ) : null}
            <Button type="button" disabled={!canSubmit || busy} onClick={() => submit.mutate()}>
              {submit.isPending ? "正在提交…" : "确认提交"}
            </Button>
          </div>
        </div>
      }
    >
      {detail.isPending ? (
        <output className="text-muted-foreground text-sm">正在加载任务…</output>
      ) : null}
      {detail.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-destructive text-sm">
            {detail.error.message}
          </p>
          <Button variant="outline" onClick={() => void detail.refetch()}>
            重新加载
          </Button>
        </div>
      ) : null}
      {data ? (
        <div className="space-y-5">
          <div className="space-y-2" aria-live="polite">
            <p className="text-muted-foreground text-sm">
              已完成 {complete} / {data.task.items.length} 份
              {running ? "，可关闭弹窗等待后台处理" : "，请确认去向"}
              {selection.isPending ? " · 正在保存选择…" : ""}
            </p>
            <Progress
              value={data.task.items.length ? (complete / data.task.items.length) * 100 : 0}
            />
          </div>
          <SmartResumeTaskSourceFields
            id={id}
            source={source}
            dirty={sourceDirty}
            saving={sourceSave.isPending}
            disabled={busy || Boolean(data.task.submittedAt)}
            onSourceChange={(value) =>
              setSourceDraft((draft) => ({ ...source, ...draft, recruitmentSource: value }))
            }
            onDetailChange={(value) =>
              setSourceDraft((draft) => ({ ...source, ...draft, recruitmentSourceDetail: value }))
            }
            onSave={() =>
              sourceSave.mutate(undefined, { onError: (error) => toast.error(error.message) })
            }
          />
          {data.jobs.length === 0 ? (
            <p className="rounded-md border p-3 text-sm">
              当前负责范围内没有可用的在招岗位。可联系管理员检查负责中心或岗位状态，调整后重新打开任务。
            </p>
          ) : null}
          {data.task.items.map((item) => (
            <SmartResumeTaskItem
              key={item.id}
              item={item}
              jobs={data.jobs}
              slug={slug}
              taskId={id}
              disabled={busy || Boolean(data.task.submittedAt)}
              onChoose={(ids, skipped) => choose(item, ids, skipped)}
              onPortfolioSave={async (attachments, files) => {
                await portfolio.mutateAsync({ attachments, files, itemId: item.id });
              }}
            />
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
