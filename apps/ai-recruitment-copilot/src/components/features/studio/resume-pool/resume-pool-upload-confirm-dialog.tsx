"use client";

import { useEffect, useState } from "react";
import type { ResumePoolScope, ResumeUploadBatchDedupPolicy } from "@arc/db-schema/schema";
import type { ResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import { resumeRecruitmentSourceNeedsDetail } from "@arc/shared/bulk-resume-upload";
import { ResumeRecruitmentSourceFields } from "@/components/features/studio/resumes/resume-recruitment-source-fields";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export interface ResumePoolUploadConfirmConfig {
  dedupPolicy: ResumeUploadBatchDedupPolicy;
  recruitmentSource: ResumeRecruitmentSource;
  recruitmentSourceDetail: string | null;
}

export function ResumePoolUploadConfirmDialog({
  fileCount,
  onConfirmed,
  onOpenChange,
  open,
  scope,
}: {
  fileCount: number;
  onConfirmed: (config: ResumePoolUploadConfirmConfig) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  scope: ResumePoolScope;
}) {
  const [recruitmentSource, setRecruitmentSource] = useState<ResumeRecruitmentSource | "">("");
  const [recruitmentSourceDetail, setRecruitmentSourceDetail] = useState("");
  const sourceNeedsDetail = resumeRecruitmentSourceNeedsDetail(recruitmentSource);
  const canStart =
    fileCount > 0 &&
    recruitmentSource.length > 0 &&
    (!sourceNeedsDetail || recruitmentSourceDetail.trim().length > 0);

  useEffect(() => {
    if (open) {
      setRecruitmentSource("");
      setRecruitmentSourceDetail("");
    }
  }, [open]);

  return (
    <Modal
      description={
        scope === "private"
          ? "命中疑似重复时仍会加入私有简历，并在列表中标记“疑似重复”。"
          : "填写简历来源后，文件将进入公共简历广场的后台解析队列。"
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button
            disabled={!canStart}
            onClick={() => {
              if (!canStart) {
                return;
              }
              onConfirmed({
                dedupPolicy: scope === "private" ? "skip" : "create",
                recruitmentSource: recruitmentSource as ResumeRecruitmentSource,
                recruitmentSourceDetail: sourceNeedsDetail ? recruitmentSourceDetail.trim() : null,
              });
            }}
          >
            开始上传 ({fileCount})
          </Button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="sm"
      title="确认上传简历"
    >
      <div className="space-y-4">
        <ResumeRecruitmentSourceFields
          detail={recruitmentSourceDetail}
          idPrefix="resume-pool-upload"
          onDetailChange={setRecruitmentSourceDetail}
          onSourceChange={setRecruitmentSource}
          source={recruitmentSource}
        />
        {scope === "private" ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
            所有简历都会被保留；系统会把疑似重复关系记录到简历上。
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
