"use client";

import { IconFile, IconFileZip, IconPhoto, IconLink, IconExternalLink } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  PortfolioAttachment,
  PortfolioItem,
  PortfolioLink,
  PortfolioLinkInput,
} from "@arc/shared/bulk-resume-upload";
import { formatBytes } from "@arc/shared/utils/format";
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

import { PortfolioAddMenu } from "./portfolio-add-menu";
import { PortfolioLinkDialog } from "./portfolio-link-dialog";

interface Props {
  attachments: PortfolioItem[];
  canDelete?: boolean;
  disabled?: boolean;
  editing: boolean;
  pendingFiles: File[];
  previewBaseUrl?: string;
  recordId: string;
  slug: string;
  onAttachmentsChange: (attachments: PortfolioItem[]) => void;
  onDelete?: (id: string) => Promise<void>;
  onLinks?: (links: PortfolioLinkInput[], linkId?: string) => Promise<void>;
  onUpload?: (files: File[]) => Promise<void>;
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
  previewBaseUrl,
  recordId,
  slug,
  onAttachmentsChange,
  onDelete,
  onUpload,
  onLinks,
  onPendingFilesChange,
}: Props) {
  const [editLink, setEditLink] = useState<PortfolioLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewResource, setPreviewResource] = useState<{ source: string; url: string } | null>(
    null,
  );
  const previewAttachment = attachments.find(
    (attachment): attachment is PortfolioAttachment =>
      attachment.id === previewId && !("url" in attachment),
  );
  const busy = disabled || deleting || uploading;
  const canUpload = editing || Boolean(onUpload);
  const baseUrl =
    previewBaseUrl ??
    `/api/w/${encodeURIComponent(slug)}/studio/resumes/${encodeURIComponent(recordId)}/portfolio`;
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

  async function uploadFiles(files: File[]) {
    if (!onUpload || busy || files.length === 0) {
      return;
    }
    setUploading(true);
    try {
      await onUpload(files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传附件失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section aria-label="附件" className="mt-4 min-w-0 space-y-2 border-t border-border/50 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">作品集</h4>
        {canUpload ? (
          <PortfolioAddMenu
            disabled={busy}
            remaining={MAX_PORTFOLIO_ATTACHMENTS - attachments.length - pendingFiles.length}
            onFiles={(files) => {
              if (editing) {
                onPendingFilesChange([...pendingFiles, ...files]);
              } else {
                void uploadFiles(files);
              }
            }}
            onLinks={async (links) => {
              if (editing) {
                onAttachmentsChange([
                  ...attachments,
                  ...links.map((link) => ({
                    ...link,
                    id: crypto.randomUUID(),
                    kind: "link" as const,
                  })),
                ]);
              } else {
                await onLinks?.(links);
              }
            }}
          />
        ) : null}
        {uploading ? <output className="text-xs text-muted-foreground">上传中…</output> : null}
      </div>
      {canUpload ? (
        <p className="text-muted-foreground text-xs">
          支持文件和多个链接，合计最多 10 项。单个文件最大 500 MB。
        </p>
      ) : null}
      {attachments.length === 0 && pendingFiles.length === 0 ? (
        <p className="text-muted-foreground text-xs">暂无作品集</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border/50">
          {attachments.map((attachment) => {
            if ("url" in attachment) {
              return (
                <li className="flex min-w-0 items-center gap-2 py-2" key={attachment.id}>
                  <IconLink className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <a
                      className="block truncate text-sm text-primary hover:underline"
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {attachment.name || attachment.url}
                    </a>
                    <p className="truncate text-xs text-muted-foreground" title={attachment.url}>
                      {attachment.url}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-primary">
                    <a
                      className="inline-flex items-center gap-1 hover:underline"
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开
                      <IconExternalLink className="size-3" />
                    </a>
                    {editing || onLinks ? (
                      <button
                        disabled={busy}
                        type="button"
                        className="hover:underline disabled:opacity-50"
                        onClick={() => setEditLink(attachment)}
                      >
                        编辑
                      </button>
                    ) : null}
                    {editing || (canDelete && onDelete) ? (
                      <button
                        aria-label={`删除附件 ${attachment.name}`}
                        disabled={busy}
                        type="button"
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        onClick={() =>
                          setDeleteTarget({
                            id: attachment.id,
                            kind: "stored",
                            name: attachment.name,
                          })
                        }
                      >
                        移除
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            }
            const url = `${baseUrl}/${encodeURIComponent(attachment.id)}`;
            return (
              <li className="flex min-w-0 items-center gap-2 py-2" key={attachment.id}>
                <AttachmentIcon mimeType={attachment.mimeType} name={attachment.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={attachment.name}>
                    {attachment.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</p>
                </div>
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
                      移除
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
          {pendingFiles.map((file, index) => (
            <li className="flex min-w-0 items-center gap-2 py-2" key={`${file.name}-${index}`}>
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
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      {editLink ? (
        <PortfolioLinkDialog
          initialLink={editLink}
          maxLinks={1}
          onClose={() => setEditLink(null)}
          onSubmit={async (links) => {
            const [link] = links;
            if (editing) {
              onAttachmentsChange(
                attachments.map((item) =>
                  item.id === editLink.id ? { ...editLink, ...link } : item,
                ),
              );
            } else {
              await onLinks?.(links, editLink.id);
            }
          }}
        />
      ) : null}
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
                    移除
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
            <AlertDialogTitle>确认移除作品集？</AlertDialogTitle>
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
