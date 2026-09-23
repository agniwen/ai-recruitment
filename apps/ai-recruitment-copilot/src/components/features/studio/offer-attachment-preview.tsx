"use client";

import { IconDownload, IconEye, IconPaperclip, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export function OfferAttachmentPreview({
  filename,
  url,
  imageUrl,
  imageAlt,
  label,
  deleteLabel,
  disabled,
  onDelete,
  onImageError,
  previewMessage,
  onPreviewOpenChange,
  compact = false,
}: {
  filename: string;
  url: string;
  imageUrl?: string | null;
  imageAlt: string;
  label: string;
  deleteLabel?: string;
  disabled?: boolean;
  onDelete?: () => void;
  onImageError?: () => void;
  previewMessage?: string;
  onPreviewOpenChange?: (open: boolean) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  function changePreviewOpen(next: boolean) {
    setPreviewOpen(next);
    onPreviewOpenChange?.(next);
  }

  return (
    <div className={compact ? "relative inline-flex max-w-80" : "relative w-full max-w-80"}>
      <HoverCard onOpenChange={setOpen} open={open}>
        <HoverCardTrigger
          delay={150}
          render={
            <button
              aria-label={`附件操作：${filename}`}
              className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(true)}
              onFocus={() => setOpen(true)}
              type="button"
            >
              <span
                className={
                  compact
                    ? "flex items-center gap-1 text-muted-foreground text-xs"
                    : "flex min-h-9 items-center gap-2 pr-10 text-sm"
                }
              >
                <IconPaperclip className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate" title={filename}>
                  {compact ? "审核附件" : `${label}${filename}`}
                </span>
              </span>
            </button>
          }
        />
        <HoverCardContent align="end" side="top" className="flex w-auto gap-1 p-1" sideOffset={4}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              changePreviewOpen(true);
            }}
            type="button"
          >
            <IconEye className="size-4" />
            查看
          </Button>
          <a
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            download={filename}
            href={url}
          >
            <IconDownload className="size-4" />
            下载
          </a>
        </HoverCardContent>
      </HoverCard>
      {onDelete ? (
        <Button
          aria-label={deleteLabel}
          className="absolute top-0.5 right-0.5 text-muted-foreground hover:text-destructive"
          disabled={disabled}
          onClick={onDelete}
          size="icon-sm"
          title="删除附件"
          type="button"
          variant="ghost"
        >
          <IconTrash className="size-4" />
        </Button>
      ) : null}
      <Dialog open={previewOpen} onOpenChange={changePreviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="break-all pr-6">{filename}</DialogTitle>
            <DialogDescription className="sr-only">附件预览</DialogDescription>
          </DialogHeader>
          {imageUrl ? (
            <img
              alt={imageAlt}
              className="max-h-[70vh] w-full object-contain"
              onError={onImageError}
              src={imageUrl}
            />
          ) : (
            <p className="py-8 text-center text-muted-foreground text-sm">
              {previewMessage ?? "此文件暂不支持预览，请下载后查看。"}
            </p>
          )}
          <a
            className={buttonVariants({ size: "sm", variant: "outline" })}
            download={filename}
            href={url}
          >
            <IconDownload className="size-4" />
            下载
          </a>
        </DialogContent>
      </Dialog>
    </div>
  );
}
