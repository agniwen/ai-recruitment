"use client";

import { useEffect, useState } from "react";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { offerSscCompletionAttachmentUrl } from "@/lib/client/api";
import { OfferAttachmentPreview } from "./offer-attachment-preview";

export function OfferSscCompletionAttachment({
  candidateId,
  draft,
  slug,
}: {
  candidateId: string;
  draft: OfferDraftRecord;
  slug: string;
}) {
  const stored = draft.sscCompletionAttachment;
  const attachment = stored?.revision === (draft.sscRevision ?? 1) ? stored : null;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    objectUrl: string;
    requestKey: string;
  } | null>(null);
  const [imageError, setImageError] = useState(false);
  const url = attachment ? offerSscCompletionAttachmentUrl(slug, candidateId, draft.id) : "";
  const requestKey = JSON.stringify([url, attachment?.revision]);
  const previewUrl = imagePreview?.requestKey === requestKey ? imagePreview.objectUrl : null;

  useEffect(() => {
    if (!previewOpen || !attachment) {
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setImagePreview(null);
    setImageError(false);
    async function loadPreview() {
      try {
        const response = await fetch(url, { credentials: "include", signal: controller.signal });
        if (!response.ok) {
          throw new Error("审批截图加载失败");
        }
        const blob = await response.blob();
        if (!controller.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setImagePreview({ objectUrl, requestKey });
        }
      } catch {
        if (!controller.signal.aborted) {
          setImageError(true);
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
  }, [attachment, previewOpen, requestKey, url]);

  if (!attachment) {
    return null;
  }
  const previewMessage = imageError ? "图片加载失败，请关闭弹窗后重试或下载查看。" : "图片加载中…";
  return (
    <OfferAttachmentPreview
      filename={attachment.filename}
      imageAlt={`内部审批截图：${attachment.filename}`}
      imageUrl={imageError ? null : previewUrl}
      label="内部审批截图："
      onImageError={() => setImageError(true)}
      onPreviewOpenChange={setPreviewOpen}
      previewMessage={previewMessage}
      url={url}
    />
  );
}
