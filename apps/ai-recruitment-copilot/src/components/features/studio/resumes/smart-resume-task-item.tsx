"use client";

import { useState } from "react";
import type { PortfolioItem, PortfolioLinkInput } from "@arc/shared/bulk-resume-upload";
import type { SmartResumeJobOption, SmartResumeTaskItemDto } from "@arc/shared/smart-resume-upload";
import { getResumeDocumentKind } from "@arc/shared/resume-documents";
import { ResumeDocumentPreviewModal } from "@/components/features/resume/resume-document-preview-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { CandidatePortfolioAttachments } from "./candidate-portfolio-attachments";

const statusLabels = { failed: "待处理", pending: "排队中", processing: "分析中", ready: "待确认" };
const ignoreEditChange = () => null;

function TaskResumePreview({ fileName, url }: { fileName: string; url: string }) {
  const [open, setOpen] = useState(false);
  const kind = getResumeDocumentKind({ fileName });
  const previewable = kind === "pdf" || kind === "image" || kind === "docx" || kind === "xlsx";
  const className =
    "break-all text-left text-xs text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <>
      {previewable ? (
        <button type="button" className={className} onClick={() => setOpen(true)}>
          {fileName}
        </button>
      ) : (
        <a className={className} href={`${url}?download=1`}>
          {fileName}
        </a>
      )}
      <ResumeDocumentPreviewModal
        fileName={fileName}
        url={open ? url : null}
        downloadUrl={`${url}?download=1`}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function TaskPortfolio({
  item,
  slug,
  baseUrl,
  disabled,
  onSave,
}: {
  item: SmartResumeTaskItemDto;
  slug: string;
  baseUrl: string;
  disabled: boolean;
  onSave: (attachments: PortfolioItem[], files?: File[]) => Promise<void>;
}) {
  const saveLinks = async (links: PortfolioLinkInput[], linkId?: string) => {
    const attachments: PortfolioItem[] = linkId
      ? item.portfolioAttachments.map((attachment) =>
          attachment.id === linkId
            ? { ...attachment, ...links[0], kind: "link" as const }
            : attachment,
        )
      : [
          ...item.portfolioAttachments,
          ...links.map((link) => ({
            ...link,
            id: crypto.randomUUID(),
            kind: "link" as const,
            name: link.name || link.url.slice(0, 500),
          })),
        ];
    await onSave(attachments);
  };
  return (
    <CandidatePortfolioAttachments
      attachments={item.portfolioAttachments}
      canDelete
      disabled={disabled}
      editing={false}
      pendingFiles={[]}
      previewBaseUrl={`${baseUrl}/portfolio`}
      recordId={item.id}
      slug={slug}
      onAttachmentsChange={ignoreEditChange}
      onPendingFilesChange={ignoreEditChange}
      onDelete={(attachmentId) =>
        onSave(item.portfolioAttachments.filter((attachment) => attachment.id !== attachmentId))
      }
      onLinks={saveLinks}
      onUpload={(files) => onSave(item.portfolioAttachments, files)}
    />
  );
}

export function SmartResumeTaskItem({
  item,
  jobs,
  slug,
  taskId,
  disabled,
  onChoose,
  onPortfolioSave,
}: {
  item: SmartResumeTaskItemDto;
  jobs: SmartResumeJobOption[];
  slug: string;
  taskId: string;
  disabled: boolean;
  onChoose: (ids: string[], skipped?: boolean) => void;
  onPortfolioSave: (attachments: PortfolioItem[], files?: File[]) => Promise<void>;
}) {
  const recommendations = (item.result?.recommendations ?? []).flatMap((rec) => {
    const job = jobs.find((option) => option.id === rec.jobDescriptionId);
    return job ? [job] : [];
  });
  const recommendedIds = new Set(recommendations.map((job) => job.id));
  const allSelected =
    recommendations.length > 0 &&
    recommendations.every((job) => item.selectedJobIds.includes(job.id));
  const canChoose = !disabled && !item.skipped;
  const baseUrl = `/api/w/${encodeURIComponent(slug)}/studio/smart-resume-tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(item.id)}`;
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label={item.candidateName || item.fileName}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {item.candidateName ? (
            <p className="break-words font-medium text-sm">{item.candidateName}</p>
          ) : null}
          <TaskResumePreview fileName={item.fileName} url={`${baseUrl}/resume`} />
        </div>
        <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>
          {statusLabels[item.status]}
        </Badge>
      </div>
      {item.error ? (
        <p className="text-destructive text-sm" role="alert">
          {item.error}
        </p>
      ) : null}
      {item.status === "ready" && !recommendations.length ? (
        <p className="text-muted-foreground text-sm">
          暂未发现足够相关的岗位，可手动选择或本次跳过。
        </p>
      ) : null}
      {recommendations.length > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">推荐岗位</h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canChoose}
            onClick={() =>
              onChoose(
                allSelected
                  ? item.selectedJobIds.filter((jobId) => !recommendedIds.has(jobId))
                  : [...new Set([...item.selectedJobIds, ...recommendedIds])],
              )
            }
          >
            {allSelected ? "取消全选" : "全选推荐岗位"}
          </Button>
        </div>
      ) : null}
      {recommendations.map((job) => {
        const selected = item.selectedJobIds.includes(job.id);
        return (
          <div
            key={job.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 p-3"
          >
            <div className="min-w-0">
              <span className="font-medium text-sm">{job.name}</span>
              <p className="text-muted-foreground text-xs">
                {[job.resumeSourceName, job.hiringUnitName, job.departmentName]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={selected ? "secondary" : "outline"}
              disabled={!canChoose}
              onClick={() =>
                onChoose(
                  selected
                    ? item.selectedJobIds.filter((id) => id !== job.id)
                    : [...item.selectedJobIds, job.id],
                )
              }
            >
              {selected ? "取消选择" : "选择岗位"}
            </Button>
          </div>
        );
      })}
      {item.status !== "pending" && item.status !== "processing" ? (
        <>
          <Field>
            <FieldLabel htmlFor={`smart-jobs-${item.id}`}>岗位去向</FieldLabel>
            <SearchableMultiSelect
              id={`smart-jobs-${item.id}`}
              options={jobs.map((job) => ({
                label: `${job.name} · ${[job.resumeSourceName, job.hiringUnitName, job.departmentName].filter(Boolean).join(" / ")}`,
                value: job.id,
              }))}
              value={item.selectedJobIds}
              onChange={(ids) => onChoose(ids)}
              placeholder="选择负责范围内的岗位"
              searchPlaceholder="搜索岗位或中心"
              disabled={!canChoose}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm" htmlFor={`smart-skip-${item.id}`}>
            <Checkbox
              id={`smart-skip-${item.id}`}
              checked={item.skipped}
              disabled={disabled}
              onCheckedChange={(checked) => onChoose([], checked === true)}
            />
            本次跳过这份简历
          </label>
        </>
      ) : null}
      <TaskPortfolio
        item={item}
        slug={slug}
        baseUrl={baseUrl}
        disabled={disabled}
        onSave={onPortfolioSave}
      />
    </section>
  );
}
