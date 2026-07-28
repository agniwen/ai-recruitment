"use client";

import type { ResumePoolScope } from "@arc/db-schema/schema";
import type { ResumePoolListRecord } from "@arc/shared/resume-pool";
import { useState } from "react";

export function useResumePoolPageState(initialUploadScope: ResumePoolScope) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadEntryOpen, setUploadEntryOpen] = useState(false);
  const [uploadScope, setUploadScope] = useState<ResumePoolScope>(initialUploadScope);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [progressOpen, setProgressOpen] = useState(false);
  const [batchListOpen, setBatchListOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ResumePoolListRecord | null>(null);
  const [previewRecord, setPreviewRecord] = useState<ResumePoolListRecord | null>(null);
  const [duplicateMatchRecord, setDuplicateMatchRecord] = useState<ResumePoolListRecord | null>(
    null,
  );
  const [importTarget, setImportTarget] = useState<ResumePoolListRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResumePoolListRecord | null>(null);
  const [selectedPrivateResumeIds, setSelectedPrivateResumeIds] = useState<Set<string>>(
    () => new Set(),
  );

  return {
    batchListOpen,
    deleteTarget,
    detailRecord,
    duplicateMatchRecord,
    importTarget,
    pendingUploadFiles,
    previewRecord,
    progressOpen,
    selectedPrivateResumeIds,
    setBatchListOpen,
    setDeleteTarget,
    setDetailRecord,
    setDuplicateMatchRecord,
    setImportTarget,
    setPendingUploadFiles,
    setPreviewRecord,
    setProgressOpen,
    setSelectedPrivateResumeIds,
    setUploadConfirmOpen,
    setUploadEntryOpen,
    setUploadOpen,
    setUploadScope,
    uploadConfirmOpen,
    uploadEntryOpen,
    uploadOpen,
    uploadScope,
  };
}
