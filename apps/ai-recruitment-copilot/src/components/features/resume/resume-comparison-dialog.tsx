"use client";

import { IconDownload } from "@tabler/icons-react";
import { useQueries } from "@tanstack/react-query";
import type { ResumePoolDetail } from "@arc/shared/resume-pool";
import type { ResumeLibraryDetail } from "@arc/shared/studio-resumes";
import type { ResumeSemanticSourceType } from "@arc/db-schema/schema";
import { useEffect, useState } from "react";
import { getPreviewableResumeDocumentKind } from "@/components/features/resume/resume-document-preview-button";
import { ResumeCandidateTitleWithCopyableId } from "@/components/features/resume/copyable-resume-record-id";
import { ResumeDocumentPreviewPane } from "@/components/features/resume/resume-document-preview-dialog";
import { ResumeProfileView } from "@/components/features/resume/resume-profile-view";
import { EmptyValue } from "@/components/features/display/empty-value";
import { TimeDisplay } from "@/components/features/display/time-display";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { fetchResumePoolItem, fetchStudioResume } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { getResumeDocumentKind } from "@arc/shared/resume-documents";

export type ResumeComparisonMode = "details" | "documents";

export interface ResumeComparisonCandidate {
  candidateName: string;
  id: string;
  sourceType?: ResumeSemanticSourceType;
}

type ResumeComparisonDetail = ResumeLibraryDetail | ResumePoolDetail;
type ResumeComparisonSourceType = "resume_pool_item" | "studio_interview";

function scrollProgress(element: HTMLElement): number {
  const scrollRange = element.scrollHeight - element.clientHeight;
  return scrollRange > 0 ? Math.min(1, Math.max(0, element.scrollTop / scrollRange)) : 0;
}

function syncScrollProgress(source: HTMLElement, target: HTMLElement): number {
  const targetScrollTop =
    scrollProgress(source) * Math.max(0, target.scrollHeight - target.clientHeight);
  if (Math.abs(target.scrollTop - targetScrollTop) >= 0.5) {
    target.scrollTop = targetScrollTop;
  }
  return targetScrollTop;
}

function useSynchronizedScroll(
  currentViewport: HTMLElement | null,
  suspectedViewport: HTMLElement | null,
  enabled: boolean,
) {
  useEffect(() => {
    if (!(enabled && currentViewport && suspectedViewport)) {
      return;
    }

    const current = currentViewport;
    const suspected = suspectedViewport;
    let programmaticScroll: { element: HTMLElement; top: number } | null = null;

    function synchronize(source: HTMLElement, target: HTMLElement) {
      programmaticScroll = {
        element: target,
        top: syncScrollProgress(source, target),
      };
    }

    function shouldIgnoreProgrammaticScroll(element: HTMLElement) {
      if (
        programmaticScroll?.element === element &&
        Math.abs(element.scrollTop - programmaticScroll.top) < 0.5
      ) {
        programmaticScroll = null;
        return true;
      }
      programmaticScroll = null;
      return false;
    }

    function handleCurrentScroll() {
      if (!shouldIgnoreProgrammaticScroll(current)) {
        synchronize(current, suspected);
      }
    }

    function handleSuspectedScroll() {
      if (!shouldIgnoreProgrammaticScroll(suspected)) {
        synchronize(suspected, current);
      }
    }

    synchronize(current, suspected);
    current.addEventListener("scroll", handleCurrentScroll, { passive: true });
    suspected.addEventListener("scroll", handleSuspectedScroll, { passive: true });

    return () => {
      current.removeEventListener("scroll", handleCurrentScroll);
      suspected.removeEventListener("scroll", handleSuspectedScroll);
    };
  }, [currentViewport, enabled, suspectedViewport]);
}

function normalizedSourceType(
  sourceType: ResumeSemanticSourceType | undefined,
): ResumeComparisonSourceType {
  return sourceType === "resume_pool_item" ? "resume_pool_item" : "studio_interview";
}

const comparisonSourceAdapters: Record<
  ResumeComparisonSourceType,
  {
    collection: "resume-pool" | "resumes";
    fetchDetail: (slug: string, id: string) => Promise<ResumeComparisonDetail | null>;
    hasResumeFile: (detail: ResumeComparisonDetail) => boolean;
  }
> = {
  resume_pool_item: {
    collection: "resume-pool",
    fetchDetail: fetchResumePoolItem,
    hasResumeFile: (detail) => "resumeStorageKey" in detail && Boolean(detail.resumeStorageKey),
  },
  studio_interview: {
    collection: "resumes",
    fetchDetail: fetchStudioResume,
    hasResumeFile: (detail) => "hasResumeFile" in detail && detail.hasResumeFile,
  },
};

function comparisonSourceAdapter(candidate: ResumeComparisonCandidate) {
  return comparisonSourceAdapters[normalizedSourceType(candidate.sourceType)];
}

function resumeUploader(detail: ResumeComparisonDetail) {
  const name =
    "uploaderName" in detail ? detail.uploaderName || detail.uploaderEmail : detail.creatorName;
  return {
    image: "uploaderImage" in detail ? detail.uploaderImage : detail.creatorImage,
    name,
  };
}

function resumeFileUrl(slug: string, candidate: ResumeComparisonCandidate) {
  const { collection } = comparisonSourceAdapter(candidate);
  return `/api/w/${slug}/studio/${collection}/${candidate.id}/resume`;
}

function resumePreviewUrl(slug: string, candidate: ResumeComparisonCandidate) {
  const { collection } = comparisonSourceAdapter(candidate);
  return `/api/w/${slug}/studio/${collection}/${candidate.id}/resume-preview.pdf`;
}

function FieldValue({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 break-words font-medium text-sm">{value || <EmptyValue />}</dd>
    </div>
  );
}

function LoadingPane() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
      <Spinner />
      正在加载简历
    </div>
  );
}

function ErrorPane() {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyTitle>简历加载失败</EmptyTitle>
        <EmptyDescription>请关闭弹窗后重试。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DetailsPane({
  candidate,
  detail,
}: {
  candidate: ResumeComparisonCandidate;
  detail: ResumeComparisonDetail;
}) {
  const sourceLabel =
    normalizedSourceType(candidate.sourceType) === "resume_pool_item" ? "简历广场" : "简历库";
  let statusLabel: string;
  if ("status" in detail) {
    statusLabel = detail.status === "active" ? "有效" : "已归档";
  } else {
    statusLabel = detail.pipelineStage === "closed" ? "已关闭" : "招聘流程中";
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
        <FieldValue label="来源" value={sourceLabel} />
        <FieldValue label="记录状态" value={statusLabel} />
        <FieldValue label="目标岗位" value={detail.targetRole} />
        <FieldValue label="关联岗位" value={detail.jobDescriptionName} />
        <FieldValue label="邮箱" value={detail.candidateEmail} />
        <FieldValue label="电话" value={detail.candidatePhone} />
      </dl>
      <ResumeProfileView profile={detail.resumeProfile ?? null} />
    </div>
  );
}

function DocumentPane({
  candidate,
  detail,
  onScrollViewportChange,
  slug,
}: {
  candidate: ResumeComparisonCandidate;
  detail: ResumeComparisonDetail;
  onScrollViewportChange: (element: HTMLElement | null) => void;
  slug: string;
}) {
  const sourceAdapter = comparisonSourceAdapter(candidate);
  if (!sourceAdapter.hasResumeFile(detail)) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyTitle>暂无原简历</EmptyTitle>
          <EmptyDescription>该记录没有可预览的简历文件。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const documentKind = getResumeDocumentKind({
    fileName: detail.resumeFileName ?? undefined,
  });
  const previewKind =
    documentKind === "pptx"
      ? "pdf"
      : getPreviewableResumeDocumentKind({
          fileName: detail.resumeFileName,
        });

  if (!previewKind) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyTitle>暂不支持预览</EmptyTitle>
          <EmptyDescription>当前仅支持 PDF、DOCX、XLSX、PPTX 和图片简历。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ResumeDocumentPreviewPane
      filename={detail.resumeFileName ?? undefined}
      kind={previewKind}
      onScrollViewportChange={onScrollViewportChange}
      url={
        documentKind === "pptx" ? resumePreviewUrl(slug, candidate) : resumeFileUrl(slug, candidate)
      }
    />
  );
}

function ComparisonContent({
  candidate,
  detail,
  isError,
  isLoading,
  mode,
  onScrollViewportChange,
  slug,
}: {
  candidate: ResumeComparisonCandidate;
  detail: ResumeComparisonDetail | null | undefined;
  isError: boolean;
  isLoading: boolean;
  mode: ResumeComparisonMode;
  onScrollViewportChange: (element: HTMLElement | null) => void;
  slug: string;
}) {
  if (isError) {
    return <ErrorPane />;
  }
  if (!isLoading && !detail) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyTitle>未找到简历</EmptyTitle>
          <EmptyDescription>这条记录可能已被删除或超出当前访问范围。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!detail) {
    return <LoadingPane />;
  }
  return mode === "details" ? (
    <DetailsPane candidate={candidate} detail={detail} />
  ) : (
    <DocumentPane
      candidate={candidate}
      detail={detail}
      onScrollViewportChange={onScrollViewportChange}
      slug={slug}
    />
  );
}

function ComparisonCard({
  candidate,
  detail,
  isError,
  isLoading,
  label,
  mode,
  onScrollViewportChange,
  slug,
}: {
  candidate: ResumeComparisonCandidate;
  detail: ResumeComparisonDetail | null | undefined;
  isError: boolean;
  isLoading: boolean;
  label: string;
  mode: ResumeComparisonMode;
  onScrollViewportChange: (element: HTMLElement | null) => void;
  slug: string;
}) {
  const uploader = detail ? resumeUploader(detail) : null;
  const [outerViewport, setOuterViewport] = useState<HTMLDivElement | null>(null);
  const [documentViewport, setDocumentViewport] = useState<HTMLElement | null>(null);

  useEffect(() => {
    onScrollViewportChange(documentViewport ?? outerViewport);
    return () => onScrollViewportChange(null);
  }, [documentViewport, onScrollViewportChange, outerViewport]);

  return (
    <Card className="min-h-0 min-w-0 overflow-hidden">
      <CardHeader className="shrink-0 border-b px-5 py-4">
        <CardTitle className="text-sm">{label}</CardTitle>
        <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
          <ResumeCandidateTitleWithCopyableId id={candidate.id} name={candidate.candidateName} />
          {detail?.resumeFileName ? (
            <span className="truncate">· {detail.resumeFileName}</span>
          ) : null}
        </CardDescription>
        {detail ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
              <span>
                上传人：
                <span className="inline-flex items-center gap-1 text-foreground">
                  <Avatar className="size-4">
                    {uploader?.image ? (
                      <AvatarImage alt={uploader.name || "上传人"} src={uploader.image} />
                    ) : null}
                    <AvatarFallback className="text-[8px]">
                      {uploader?.name?.slice(0, 1).toUpperCase() || "—"}
                    </AvatarFallback>
                  </Avatar>
                  {uploader?.name || "—"}
                </span>
              </span>
              <span className="inline-flex items-center">
                上传时间：
                <TimeDisplay className="text-foreground" value={detail.createdAt} />
              </span>
            </div>
            {mode === "documents" && comparisonSourceAdapter(candidate).hasResumeFile(detail) ? (
              <Button
                nativeButton={false}
                render={
                  <a
                    download={detail.resumeFileName ?? undefined}
                    href={resumeFileUrl(slug, candidate)}
                  >
                    <IconDownload />
                    下载
                  </a>
                }
                size="xs"
                variant="outline"
              />
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardPanel
        className={
          mode === "details"
            ? "min-h-0 overflow-y-auto p-5"
            : "min-h-0 overflow-hidden bg-muted/30 p-0"
        }
        data-resume-compare-scroll-container={label === "当前简历" ? "current" : "suspected"}
        ref={setOuterViewport}
      >
        <ComparisonContent
          candidate={candidate}
          detail={detail}
          isError={isError}
          isLoading={isLoading}
          mode={mode}
          onScrollViewportChange={setDocumentViewport}
          slug={slug}
        />
      </CardPanel>
    </Card>
  );
}

export function ResumeComparisonDialog({
  current,
  mode,
  onOpenChange,
  open,
  suspected,
}: {
  current: ResumeComparisonCandidate | null;
  suspected: ResumeComparisonCandidate | null;
  mode: ResumeComparisonMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const slug = useWorkspaceSlug();
  const [isScrollSyncEnabled, setIsScrollSyncEnabled] = useState(true);
  const [currentViewport, setCurrentViewport] = useState<HTMLElement | null>(null);
  const [suspectedViewport, setSuspectedViewport] = useState<HTMLElement | null>(null);
  const candidates = [current, suspected] as const;
  const results = useQueries({
    queries: candidates.map((candidate) => ({
      enabled: open && Boolean(candidate),
      queryFn: () =>
        candidate ? comparisonSourceAdapter(candidate).fetchDetail(slug, candidate.id) : null,
      queryKey: [
        "resume-comparison",
        slug,
        normalizedSourceType(candidate?.sourceType),
        candidate?.id ?? null,
      ],
      staleTime: 30_000,
    })),
  });
  useSynchronizedScroll(currentViewport, suspectedViewport, isScrollSyncEnabled);

  useEffect(() => {
    if (open) {
      setIsScrollSyncEnabled(true);
    }
  }, [open]);

  if (!current || !suspected) {
    return null;
  }

  return (
    <Modal
      bodyClassName="min-h-0 overflow-hidden bg-muted/30 p-4"
      className="h-[92dvh]"
      description={
        mode === "details"
          ? "左侧为当前简历，右侧为疑似简历，可对照候选人信息与履历。"
          : "左侧为当前简历，右侧为疑似简历，可对照原始简历内容。"
      }
      onOpenChange={onOpenChange}
      open={open}
      size="full"
      title={mode === "details" ? "简历详情对比" : "原简历对比"}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="flex items-center rounded-xl border bg-background px-4 py-2.5">
          <Field className="w-auto gap-2" orientation="horizontal">
            <Checkbox
              checked={isScrollSyncEnabled}
              id="resume-dedup-sync-scroll"
              onCheckedChange={setIsScrollSyncEnabled}
            />
            <FieldLabel htmlFor="resume-dedup-sync-scroll">同步滚动</FieldLabel>
          </Field>
        </div>
        <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <ComparisonCard
            candidate={current}
            detail={results[0]?.data}
            isError={Boolean(results[0]?.isError)}
            isLoading={Boolean(results[0]?.isLoading)}
            label="当前简历"
            mode={mode}
            onScrollViewportChange={setCurrentViewport}
            slug={slug}
          />
          <ComparisonCard
            candidate={suspected}
            detail={results[1]?.data}
            isError={Boolean(results[1]?.isError)}
            isLoading={Boolean(results[1]?.isLoading)}
            label="疑似简历"
            mode={mode}
            onScrollViewportChange={setSuspectedViewport}
            slug={slug}
          />
        </div>
      </div>
    </Modal>
  );
}
