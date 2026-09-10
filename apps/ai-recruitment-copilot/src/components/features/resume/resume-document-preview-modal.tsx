"use client";

import { useEffect, useState } from "react";
import { getResumeDocumentKind } from "@arc/shared/resume-documents";
import { ResumeDocumentPreviewDialog } from "./resume-document-preview-dialog";
import type { ResumeDocumentPreviewKind } from "./resume-document-preview-dialog";

interface Preview {
  filename?: string;
  downloadUrl?: string;
  kind: ResumeDocumentPreviewKind;
  url: string;
}

export function ResumeDocumentPreviewModal({
  fileName,
  downloadUrl,
  kind: suppliedKind,
  onClose,
  url,
}: {
  fileName?: string | null;
  downloadUrl?: string;
  kind?: ResumeDocumentPreviewKind | null;
  onClose: () => void;
  url: string | null;
}) {
  const kind = suppliedKind ?? getResumeDocumentKind({ fileName: fileName ?? undefined });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Commit closed before opening; retain content throughout exit.
    setOpen(false);
    if (url && (kind === "pdf" || kind === "image" || kind === "docx" || kind === "xlsx")) {
      // oxlint-disable-next-line react/set-state-in-effect -- Incoming preview identity controls the retained dialog payload.
      setPreview({ downloadUrl, filename: fileName ?? undefined, kind, url });
    }
  }, [downloadUrl, fileName, kind, url]);

  useEffect(() => {
    if (!(preview && url)) {
      return;
    }
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [preview, url]);

  return preview ? (
    <ResumeDocumentPreviewDialog
      {...preview}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setPreview(null);
          onClose();
        }
      }}
      open={open}
    />
  ) : null;
}
