"use client";

import { IconFileText as FileTextIcon, IconX as XIcon } from "@tabler/icons-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ResumePoolImportDestination } from "@arc/shared/resume-pool";
import { ResumePoolImportDestinations } from "../resume-pool/resume-pool-import-destinations";
import {
  EMPTY_IMPORT_OPTIONS,
  emptyImportDestination,
  importJobNameOptions,
  resolveImportDestinations,
} from "../resume-pool/resume-pool-import-selection";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getCandidateImportOptions } from "@/lib/client/api/endpoints/bulk-resume-upload";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { ResumeUploadBatchDedupPolicy, ResumeUploadBatchJdMode } from "@arc/db-schema/schema";
import {
  MAX_BULK_DESTINATIONS,
  resumeRecruitmentSourceNeedsDetail,
} from "@arc/shared/bulk-resume-upload";
import type { ResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import { ResumeRecruitmentSourceFields } from "./resume-recruitment-source-fields";

export interface BulkUploadConfirmConfig {
  destinations: { hiringUnitId: string; jobDescriptionId: string }[];
  jdMode: ResumeUploadBatchJdMode;
  jobDescriptionId: string | null;
  dedupPolicy: ResumeUploadBatchDedupPolicy;
  recruitmentSource: ResumeRecruitmentSource;
  recruitmentSourceDetail: string | null;
}

interface Props {
  open: boolean;
  files: File[];
  onOpenChange: (open: boolean) => void;
  onConfirmed: (files: File[], config: BulkUploadConfirmConfig) => void;
  onRemoveFile: (index: number) => void;
}

// 格式化文件大小，返回人类可读的字符串。
// Format file size into a human-readable string.
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function BulkUploadConfirmDialog({
  files,
  onConfirmed,
  onOpenChange,
  onRemoveFile,
  open,
}: Props) {
  const slug = useWorkspaceSlug();
  const optionsQuery = useQuery({
    enabled: open,
    queryFn: () => getCandidateImportOptions(slug),
    queryKey: ["candidate-import-options", slug],
  });
  const options = optionsQuery.data ?? EMPTY_IMPORT_OPTIONS;
  const [jobName, setJobName] = useState("");
  const [destinations, setDestinations] = useState<ResumePoolImportDestination[]>([]);
  const resolvedDestinations = resolveImportDestinations(options, jobName, destinations);
  const selectedDestinationCount = resolvedDestinations.filter(
    (row) => row.jobDescriptionId,
  ).length;
  const [recruitmentSource, setRecruitmentSource] = useState<ResumeRecruitmentSource | "">("");
  const [recruitmentSourceDetail, setRecruitmentSourceDetail] = useState("");

  const sourceNeedsDetail = resumeRecruitmentSourceNeedsDetail(recruitmentSource);
  const canStart =
    files.length > 0 &&
    recruitmentSource.length > 0 &&
    (!sourceNeedsDetail || recruitmentSourceDetail.trim().length > 0) &&
    !optionsQuery.isPending &&
    !optionsQuery.isError &&
    jobName.length > 0 &&
    resolvedDestinations.length > 0 &&
    selectedDestinationCount <= MAX_BULK_DESTINATIONS &&
    resolvedDestinations.every((row) => row.jobDescriptionId);

  function handleStart() {
    if (!canStart) {
      return;
    }
    onConfirmed(files, {
      dedupPolicy: "skip",
      destinations: resolvedDestinations.flatMap((row) =>
        row.jobDescriptionId
          ? [{ hiringUnitId: row.hiringUnitId, jobDescriptionId: row.jobDescriptionId }]
          : [],
      ),
      jdMode: "bind",
      jobDescriptionId: null,
      recruitmentSource: recruitmentSource as ResumeRecruitmentSource,
      recruitmentSourceDetail: sourceNeedsDetail ? recruitmentSourceDetail.trim() : null,
    });
  }

  return (
    <Modal
      description={`上传 ${files.length} 份简历，每份按选中的具体岗位去向分别创建记录。部门和服务单位由岗位自动带出。`}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            取消
          </Button>
          <Button disabled={!canStart} onClick={handleStart} type="button">
            开始上传（{files.length} 份 / {files.length * selectedDestinationCount} 条记录）
          </Button>
        </div>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="md"
      title="批量上传简历"
    >
      <div className="space-y-6">
        {/* 文件清单 / File list */}
        <div>
          <Label className="mb-2 block text-sm">文件清单</Label>
          <Card className="gap-0 overflow-hidden rounded-md py-0">
            <CardContent className="p-0">
              <ul className="max-h-48 space-y-1 overflow-y-auto bg-muted/30 p-2 text-sm">
                {files.map((f, idx) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-background"
                    key={`${f.name}-${f.size}-${f.lastModified}-${f.type}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatSize(f.size)}
                      </span>
                    </span>
                    {files.length > 1 ? (
                      <button
                        aria-label="移除"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => onRemoveFile(idx)}
                        type="button"
                      >
                        <XIcon className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <ResumeRecruitmentSourceFields
          detail={recruitmentSourceDetail}
          idPrefix="resume-recruitment"
          onDetailChange={setRecruitmentSourceDetail}
          onSourceChange={setRecruitmentSource}
          source={recruitmentSource}
        />

        <div className="space-y-3">
          <Label htmlFor="candidate-import-job">在招岗位（必选）</Label>
          <SearchableSelect
            id="candidate-import-job"
            value={jobName || null}
            options={importJobNameOptions(options, resolvedDestinations)}
            placeholder="请选择在招岗位"
            disabled={optionsQuery.isPending}
            onChange={(value) => {
              setJobName(value ?? "");
              setDestinations((rows) =>
                [...new Set(rows.map((row) => row.hiringUnitId))].map(emptyImportDestination),
              );
            }}
          />
          {optionsQuery.isError ? (
            <div role="alert">
              岗位和组织加载失败。
              <Button variant="link" onClick={() => void optionsQuery.refetch()}>
                重试
              </Button>
            </div>
          ) : null}
          <ResumePoolImportDestinations
            multipleJobs
            options={options}
            jobName={jobName}
            destinations={resolvedDestinations}
            onChange={setDestinations}
            disabled={optionsQuery.isPending || optionsQuery.isError}
          />
          {selectedDestinationCount > MAX_BULK_DESTINATIONS ? (
            <p role="alert" className="text-sm text-destructive">
              每次最多选择 {MAX_BULK_DESTINATIONS} 个具体岗位去向，请减少选择。
            </p>
          ) : null}
        </div>

        {/* 查重说明 / Deduplication note */}
        <div>
          <Label className="mb-2 block text-sm">查重处理</Label>
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
            命中疑似重复时仍会入库，并在列表中标记“疑似重复”。
          </p>
        </div>
      </div>
    </Modal>
  );
}
