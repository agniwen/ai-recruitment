"use client";

import { IconFileUpload, IconHistory, IconSparkles } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MAX_BULK_BATCH_SIZE, MAX_RESUME_FILE_SIZE_BYTES } from "@arc/shared/bulk-resume-upload";
import type { BulkResumeUploadFileDescriptor } from "@arc/shared/bulk-resume-upload";
import {
  isSupportedResumeDocumentInput,
  supportedResumeDocumentAccept,
  supportedResumeDocumentLabel,
} from "@arc/shared/resume-documents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileUpload } from "@/components/ui/file-upload";
import { FieldGroup } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { authClient } from "@/lib/client/auth-client";
import { uploadResumeForBulk } from "@/lib/client/api/endpoints/bulk-resume-upload";
import {
  createSmartResumeTask,
  listSmartResumeTasks,
} from "@/lib/client/api/endpoints/smart-resume-upload";
import type { SmartResumeTaskSummary } from "@arc/shared/smart-resume-upload";
import { SmartResumeTaskDialog } from "./smart-resume-task-dialog";

function taskSummaryLabel(task: SmartResumeTaskSummary) {
  if (task.total > task.ready + task.failed) {
    return "分析中";
  }
  return task.failed ? "待处理" : "待确认";
}

function SmartUploadButton({
  count,
  disabled,
  onClick,
}: {
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="relative"
      aria-label={count ? `智能上传，${count} 个待提交任务` : "智能上传"}
      onClick={onClick}
      disabled={disabled}
    >
      <IconSparkles className="size-4" />
      智能上传
      {count > 0 ? (
        <Badge
          aria-hidden="true"
          variant="destructive"
          className="pointer-events-none absolute -top-2 -right-2 border-background bg-destructive text-white tabular-nums dark:bg-destructive"
        >
          {count}
        </Badge>
      ) : null}
    </Button>
  );
}

function SmartResumeUploadContent({ onSubmitted }: { onSubmitted: () => void }) {
  const slug = useWorkspaceSlug();
  const client = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [view, setView] = useState<"upload" | "tasks">("upload");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState(0);
  const [uploadSession, setUploadSession] = useState(0);
  const requestId = useRef("");
  const descriptors = useRef(new Map<File, BulkResumeUploadFileDescriptor>());
  const key = ["smart-resume-tasks", slug];
  const tasks = useQuery({
    queryFn: () => listSmartResumeTasks(slug),
    queryKey: key,
    refetchInterval: (query) =>
      uploadOpen && query.state.data?.tasks.some((task) => task.total > task.ready + task.failed)
        ? 5000
        : 30_000,
    staleTime: 5000,
  });
  const unsubmittedCount = tasks.data?.tasks.length ?? 0;
  const upload = useMutation({
    mutationFn: async () => {
      if (!files.length) {
        throw new Error("请选择简历文件");
      }
      const uploadedFiles: BulkResumeUploadFileDescriptor[] = [];
      for (const file of files) {
        const stored = descriptors.current.get(file) ?? (await uploadResumeForBulk(slug, file));
        descriptors.current.set(file, stored);
        uploadedFiles.push(stored);
        setUploaded(uploadedFiles.length);
      }
      return await createSmartResumeTask(slug, {
        files: uploadedFiles,
        requestId: requestId.current,
      });
    },
    onError: (error) => toast.error(error.message),
    onSuccess: async (result) => {
      setUploadOpen(false);
      setTaskId(result.id);
      await client.invalidateQueries({ queryKey: key });
      if (result.queued) {
        toast.success("已开始后台分析，可稍后继续确认岗位去向。");
      } else {
        toast.warning("任务已保存，后台排队未完成，可在任务中重试。");
      }
    },
  });

  function startUpload() {
    requestId.current = crypto.randomUUID();
    descriptors.current.clear();
    setFiles([]);
    setUploadSession((value) => value + 1);
    setUploaded(0);
    upload.reset();
    setView("upload");
    setUploadOpen(true);
  }

  return (
    <>
      <SmartUploadButton
        count={unsubmittedCount}
        onClick={startUpload}
        disabled={upload.isPending}
      />
      <Modal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        dismissible={!upload.isPending}
        title={view === "upload" ? "智能上传简历" : "待提交的智能上传任务"}
        size={view === "upload" ? "md" : "lg"}
        description={
          view === "upload"
            ? "上传后自动分析并推荐负责范围内的在招岗位，确认去向后再提交。"
            : "仅显示尚未提交的任务。处理中的任务会自动更新，已提交任务不再显示。"
        }
        headerExtra={
          view === "upload" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => {
                setView("tasks");
                void tasks.refetch();
              }}
            >
              <IconHistory className="size-4" />
              待提交任务{tasks.data?.tasks.length ? `（${tasks.data.tasks.length}）` : ""}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setView("upload")}>
              返回上传
            </Button>
          )
        }
        footer={
          view === "upload" ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={upload.isPending}
                onClick={() => setUploadOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={upload.isPending || !files.length}
                onClick={() => upload.mutate()}
              >
                {upload.isPending ? `正在上传 ${uploaded}/${files.length}…` : "上传并开始分析"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setUploadOpen(false)}>
              关闭
            </Button>
          )
        }
      >
        <div hidden={view !== "upload"}>
          <FieldGroup>
            <FileUpload
              key={uploadSession}
              accept={supportedResumeDocumentAccept}
              acceptedFileTypes={[{ icon: IconFileUpload, label: supportedResumeDocumentLabel }]}
              ariaLabel="选择智能上传的简历"
              browseLabel="选择简历文件"
              title="选择一份或多份简历"
              description={`支持 ${supportedResumeDocumentLabel}，每份不超过 20 MB，最多 ${MAX_BULK_BATCH_SIZE} 份。`}
              multiple
              maxFiles={MAX_BULK_BATCH_SIZE}
              disabled={upload.isPending}
              onFileLimitExceeded={() => setFiles([])}
              onFilesSelected={(selected) => {
                if (
                  selected.length > MAX_BULK_BATCH_SIZE ||
                  selected.some(
                    (file) =>
                      file.size > MAX_RESUME_FILE_SIZE_BYTES ||
                      !isSupportedResumeDocumentInput({
                        fileName: file.name,
                        mediaType: file.type,
                      }),
                  )
                ) {
                  setFiles([]);
                  toast.error("请检查文件格式、大小与数量");
                  return false;
                }
                return true;
              }}
              onFilesAccepted={(selected) => {
                setFiles(selected);
                setUploaded(0);
                descriptors.current.clear();
                requestId.current = crypto.randomUUID();
              }}
            />
            <output className="text-muted-foreground text-xs">
              {upload.isPending
                ? "文件上传中，请保留当前页面；上传完成后，分析任务会在后台继续。"
                : "分析任务和岗位选择会自动保存，刷新页面后仍可继续。"}
            </output>
          </FieldGroup>
        </div>
        {view === "tasks" ? (
          <>
            {tasks.isPending ? (
              <output className="text-muted-foreground text-sm">正在加载…</output>
            ) : null}
            {tasks.isError ? (
              <div className="space-y-2">
                <p role="alert" className="text-destructive text-sm">
                  {tasks.error.message}
                </p>
                <Button type="button" variant="outline" onClick={() => void tasks.refetch()}>
                  重新加载
                </Button>
              </div>
            ) : null}
            {tasks.data?.tasks.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">暂无待提交任务</p>
            ) : null}
            <div className="space-y-3">
              {tasks.data?.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <p className="font-medium text-sm">
                      {task.total} 份简历{" "}
                      <Badge variant="secondary">{taskSummaryLabel(task)}</Badge>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {new Date(task.createdAt).toLocaleString("zh-CN", { hour12: false })} · 已分析{" "}
                      {task.ready} 份{task.failed ? ` · 待处理 ${task.failed} 份` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setUploadOpen(false);
                      setTaskId(task.id);
                    }}
                  >
                    继续处理
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Modal>
      {taskId ? (
        <SmartResumeTaskDialog
          key={`${slug}:${taskId}`}
          slug={slug}
          id={taskId}
          onClose={() => setTaskId(null)}
          onSubmitted={onSubmitted}
        />
      ) : null}
    </>
  );
}

export function SmartResumeUpload({ onSubmitted }: { onSubmitted: () => void }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending || session?.user.role !== "admin") {
    return null;
  }
  return <SmartResumeUploadContent onSubmitted={onSubmitted} />;
}
