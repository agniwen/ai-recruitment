"use client";

import { IconFile, IconFileZip, IconPhoto, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PortfolioAttachment } from "@arc/shared/bulk-resume-upload";
import { MAX_PORTFOLIO_ATTACHMENTS } from "@arc/shared/bulk-resume-upload";
import { apiFetch } from "@/lib/client/api/client";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  attachments: PortfolioAttachment[];
  canDelete?: boolean;
  disabled?: boolean;
  editing: boolean;
  pendingFiles: File[];
  recordId: string;
  slug: string;
  onAttachmentsChange: (attachments: PortfolioAttachment[]) => void;
  onDelete?: (id: string) => Promise<void>;
  onPendingFilesChange: (files: File[]) => void;
}

type DeleteTarget =
  | { kind: "stored"; id: string; name: string }
  | { kind: "pending"; index: number; name: string };

function AttachmentIcon({ mimeType, name }: { mimeType: string; name: string }) {
  if (mimeType.startsWith("image/")) {
    return <IconPhoto className="size-4 shrink-0 text-muted-foreground" />;
  }
  if (/\.(zip|rar|7z)$/i.test(name)) {
    return <IconFileZip className="size-4 shrink-0 text-muted-foreground" />;
  }
  return <IconFile className="size-4 shrink-0 text-muted-foreground" />;
}

function PortfolioPreview({
  attachment,
  failed,
  loading,
  url,
  onError,
}: {
  attachment: PortfolioAttachment;
  failed: boolean;
  loading: boolean;
  url: string | null;
  onError: () => void;
}) {
  if (failed) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        预览加载失败，请下载后查看。
      </p>
    );
  }
  if (loading) {
    return (
      <output className="block py-12 text-center text-sm text-muted-foreground">
        正在加载预览…
      </output>
    );
  }
  if (attachment.mimeType.startsWith("image/")) {
    return (
      <img
        alt={attachment.name}
        className="max-h-[65vh] w-full object-contain"
        onError={onError}
        src={url ?? undefined}
      />
    );
  }
  if (attachment.mimeType === "application/pdf") {
    return (
      <iframe
        className="h-[65vh] w-full rounded-md border"
        src={url ?? undefined}
        title={attachment.name}
      />
    );
  }
  if (attachment.mimeType.startsWith("video/")) {
    return (
      <video
        className="max-h-[65vh] w-full"
        controls
        onError={onError}
        preload="metadata"
        src={url ?? undefined}
      >
        当前浏览器不支持视频预览，请下载后查看。
      </video>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
      <AttachmentIcon mimeType={attachment.mimeType} name={attachment.name} />
      <p>此文件暂不支持在线预览，请下载后查看。</p>
    </div>
  );
}

// oxlint-disable-next-line complexity -- Coordinates pending/stored attachments, edit permissions, deletion confirmation and preview state.
export function CandidatePortfolioAttachments({
  attachments,
  canDelete = false,
  disabled = false,
  editing,
  pendingFiles,
  recordId,
  slug,
  onAttachmentsChange,
  onDelete,
  onPendingFilesChange,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewResource, setPreviewResource] = useState<{ source: string; url: string } | null>(
    null,
  );
  const previewAttachment = attachments.find((attachment) => attachment.id === previewId);
  const busy = disabled || deleting;
  const baseUrl = `/api/w/${encodeURIComponent(slug)}/studio/resumes/${encodeURIComponent(recordId)}/portfolio`;
  const previewUrl = previewAttachment
    ? `${baseUrl}/${encodeURIComponent(previewAttachment.id)}`
    : "";
  const canPreview = Boolean(
    previewAttachment &&
    (previewAttachment.mimeType.startsWith("image/") ||
      previewAttachment.mimeType === "application/pdf" ||
      previewAttachment.mimeType.startsWith("video/")),
  );
  const previewObjectUrl = previewResource?.source === previewUrl ? previewResource.url : null;

  useEffect(() => {
    if (!previewUrl || !canPreview) {
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;

    // Fetch through the API: dev middleware can treat direct image requests as static assets.
    async function loadPreview() {
      try {
        const response = await apiFetch<Response>(previewUrl, {
          decode: "raw",
          signal: controller.signal,
        });
        const blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreviewResource({ source: previewUrl, url: objectUrl });
      } catch {
        if (!controller.signal.aborted) {
          setPreviewFailed(true);
        }
      }
    }

    void loadPreview();
    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [canPreview, previewUrl]);

  async function confirmDelete() {
    if (!deleteTarget || busy) {
      return;
    }
    setDeleting(true);
    try {
      if (deleteTarget.kind === "pending") {
        onPendingFilesChange(pendingFiles.filter((_, index) => index !== deleteTarget.index));
      } else if (editing) {
        onAttachmentsChange(attachments.filter((attachment) => attachment.id !== deleteTarget.id));
      } else if (onDelete) {
        await onDelete(deleteTarget.id);
      }
      if (deleteTarget.kind === "stored" && deleteTarget.id === previewId) {
        setPreviewId(null);
      }
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除附件失败");
    } finally {
      setDeleting(false);
    }
  }

  if (!editing && attachments.length === 0) {
    return null;
  }
  return (
    <section aria-label="附件" className="mt-3 min-w-0 space-y-1">
      <div className="flex items-center gap-2">
        <h4 className="text-xs text-muted-foreground">作品集-附件</h4>
        {editing && attachments.length + pendingFiles.length < MAX_PORTFOLIO_ATTACHMENTS ? (
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
            <IconPlus className="size-3.5" />
            上传附件
            <input
              aria-label="上传作品集附件"
              accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.mov,.zip"
              className="sr-only"
              disabled={busy}
              multiple
              onChange={(event) => {
                onPendingFilesChange(
                  [...pendingFiles, ...(event.target.files ?? [])].slice(
                    0,
                    MAX_PORTFOLIO_ATTACHMENTS - attachments.length,
                  ),
                );
                event.target.value = "";
              }}
              type="file"
            />
          </label>
        ) : null}
      </div>
      {editing ? <p className="text-muted-foreground text-xs">单个附件最大 500 MB。</p> : null}
      {attachments.length === 0 && pendingFiles.length === 0 ? (
        <p className="text-muted-foreground text-xs">暂无附件</p>
      ) : (
        <ul className="flex min-w-0 flex-col">
          {attachments.map((attachment) => {
            const url = `${baseUrl}/${encodeURIComponent(attachment.id)}`;
            return (
              <li className="flex min-w-0 items-center gap-2 py-1" key={attachment.id}>
                <AttachmentIcon mimeType={attachment.mimeType} name={attachment.name} />
                <span className="min-w-0 flex-1 truncate text-sm" title={attachment.name}>
                  {attachment.name}
                </span>
                <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-primary">
                  <button
                    className="hover:underline"
                    onClick={() => {
                      setPreviewFailed(false);
                      setPreviewResource(null);
                      setPreviewId(attachment.id);
                    }}
                    type="button"
                  >
                    查看
                  </button>
                  <a className="hover:underline" href={`${url}?download=1`}>
                    下载
                  </a>
                  {editing || (canDelete && onDelete) ? (
                    <button
                      aria-label={`删除附件 ${attachment.name}`}
                      className="text-muted-foreground hover:text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        setDeleteTarget({
                          id: attachment.id,
                          kind: "stored",
                          name: attachment.name,
                        })
                      }
                      type="button"
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
          {pendingFiles.map((file, index) => (
            <li className="flex min-w-0 items-center gap-2 py-1" key={`${file.name}-${index}`}>
              <AttachmentIcon mimeType={file.type} name={file.name} />
              <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">待上传</span>
              <button
                aria-label={`移除待上传附件 ${file.name}`}
                className="shrink-0 text-xs text-muted-foreground hover:text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={() => setDeleteTarget({ index, kind: "pending", name: file.name })}
                type="button"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewId(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          {previewAttachment ? (
            <>
              <DialogHeader>
                <DialogTitle className="break-all pr-6">{previewAttachment.name}</DialogTitle>
                <DialogDescription>附件预览</DialogDescription>
              </DialogHeader>
              <PortfolioPreview
                attachment={previewAttachment}
                failed={previewFailed}
                loading={canPreview && !previewObjectUrl}
                url={previewObjectUrl}
                onError={() => setPreviewFailed(true)}
              />
              <DialogFooter>
                {editing || (canDelete && onDelete) ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      setDeleteTarget({
                        id: previewAttachment.id,
                        kind: "stored",
                        name: previewAttachment.name,
                      })
                    }
                    type="button"
                    variant="destructive"
                  >
                    删除
                  </Button>
                ) : null}
                <a
                  className={buttonVariants({ variant: "outline" })}
                  download={previewAttachment.name}
                  href={`${previewUrl}?download=1`}
                >
                  下载
                </a>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除附件？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name}
              {editing ? " 将在保存候选人信息后移除。" : " 将从该候选人的附件中移除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button disabled={busy} onClick={() => void confirmDelete()} variant="destructive">
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
