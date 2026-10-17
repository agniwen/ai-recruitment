"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { MAX_SSC_COMPLETION_SCREENSHOT_BYTES } from "@arc/shared/studio-pipeline-stages";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OfferAttachmentPreview } from "./offer-attachment-preview";

const screenshotTypes = ["image/jpeg", "image/png", "image/webp"];

function validateScreenshot(file: File): string | null {
  if (!screenshotTypes.includes(file.type)) {
    return "请选择 JPEG、PNG 或 WebP 图片。";
  }
  if (file.size === 0) {
    return "请选择非空的审批截图。";
  }
  return file.size > MAX_SSC_COMPLETION_SCREENSHOT_BYTES ? "审批截图不能超过 10 MB。" : null;
}

export function OfferSscCompleteDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (file: File | null) => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMessage, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearFile() {
    setFile(null);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function selectFile(next: File | null) {
    clearFile();
    if (!next) {
      return;
    }
    const message = validateScreenshot(next);
    if (message) {
      setError(message);
      return;
    }
    setFile(next);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (submitting) {
      return;
    }
    const pasted = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
    if (pasted) {
      event.preventDefault();
      selectFile(pasted);
    }
  }

  async function confirmCompletion() {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(file);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "SSC完成确认失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submitting) {
          onClose();
        }
      }}
    >
      <DialogContent onPaste={handlePaste} showCloseButton={!submitting} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>是否已经完成内部审批</DialogTitle>
          <DialogDescription>
            请确认该 Offer 已完成内部审批。确认完成后，才可继续发送 Offer 或标记入职。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="offer-ssc-completion-attachment">审批截图（可选）</Label>
          <Input
            accept={screenshotTypes.join(",")}
            disabled={submitting}
            id="offer-ssc-completion-attachment"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            ref={inputRef}
            type="file"
          />
          <p className="text-muted-foreground text-xs">
            可选择或直接粘贴一张 JPEG、PNG 或 WebP 图片，最大 10 MB；未上传也可以完成确认。
          </p>
          {file ? (
            <OfferAttachmentPreview
              deleteLabel={`移除审批截图 ${file.name}`}
              disabled={submitting}
              filename={file.name}
              imageAlt={`审批截图预览：${file.name}`}
              imageUrl={previewUrl}
              label="已选择："
              onDelete={clearFile}
              url={previewUrl ?? ""}
            />
          ) : null}
          {errorMessage ? (
            <p className="text-destructive text-sm" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button disabled={submitting} onClick={onClose} variant="outline">
            取消
          </Button>
          <Button disabled={submitting} onClick={confirmCompletion}>
            {submitting ? "确认中…" : "已完成内部审批，确认完成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
