"use client";

import { useQueries } from "@tanstack/react-query";
import type { ResumePoolDetail } from "@arc/shared/resume-pool";
import type { ResumeLibraryDetail } from "@arc/shared/studio-resumes";
import type { ResumeSemanticSourceType } from "@arc/db-schema/schema";
import { getPreviewableResumeDocumentKind } from "@/components/features/resume/resume-document-preview-button";
import { formatResumeCandidateTitle } from "@/components/features/resume/resume-record-display-id";
import { ResumeDocumentPreviewPane } from "@/components/features/resume/resume-document-preview-dialog";
import { ResumeProfileView } from "@/components/features/resume/resume-profile-view";
import { EmptyValue } from "@/components/features/display/empty-value";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { fetchResumePoolItem, fetchStudioResume } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export type ResumeComparisonMode = "details" | "documents";

export interface ResumeComparisonCandidate {
  candidateName: string;
  id: string;
  sourceType?: ResumeSemanticSourceType;
}

type ResumeComparisonDetail = ResumeLibraryDetail | ResumePoolDetail;
type ResumeComparisonSourceType = "resume_pool_item" | "studio_interview";

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

function resumeFileUrl(slug: string, candidate: ResumeComparisonCandidate) {
  const { collection } = comparisonSourceAdapter(candidate);
  return `/api/w/${slug}/studio/${collection}/${candidate.id}/resume`;
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

function DetailsPane({ detail }: { detail: ResumeComparisonDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
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
  slug,
}: {
  candidate: ResumeComparisonCandidate;
  detail: ResumeComparisonDetail;
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

  const previewKind = getPreviewableResumeDocumentKind({
    fileName: detail.resumeFileName,
  });

  if (!previewKind) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyTitle>暂不支持预览</EmptyTitle>
          <EmptyDescription>当前仅支持 PDF、DOCX、XLSX 和图片简历。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ResumeDocumentPreviewPane
      filename={detail.resumeFileName ?? undefined}
      kind={previewKind}
      url={resumeFileUrl(slug, candidate)}
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
  slug,
}: {
  candidate: ResumeComparisonCandidate;
  detail: ResumeComparisonDetail | null | undefined;
  isError: boolean;
  isLoading: boolean;
  label: string;
  mode: ResumeComparisonMode;
  slug: string;
}) {
  let content = <LoadingPane />;
  if (isError) {
    content = <ErrorPane />;
  } else if (!isLoading && !detail) {
    content = (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyTitle>未找到简历</EmptyTitle>
          <EmptyDescription>这条记录可能已被删除或超出当前访问范围。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (detail) {
    content =
      mode === "details" ? (
        <DetailsPane detail={detail} />
      ) : (
        <DocumentPane candidate={candidate} detail={detail} slug={slug} />
      );
  }

  return (
    <Card className="min-h-0 min-w-0 overflow-hidden">
      <CardHeader className="shrink-0 border-b px-5 py-4">
        <CardTitle className="text-sm">{label}</CardTitle>
        <CardDescription className="truncate">
          {formatResumeCandidateTitle(candidate.candidateName, candidate.id)}
          {detail?.resumeFileName ? ` · ${detail.resumeFileName}` : ""}
        </CardDescription>
      </CardHeader>
      <CardPanel
        className={
          mode === "details"
            ? "min-h-0 overflow-y-auto p-5"
            : "min-h-0 overflow-hidden bg-muted/30 p-0"
        }
      >
        {content}
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
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <ComparisonCard
          candidate={current}
          detail={results[0]?.data}
          isError={Boolean(results[0]?.isError)}
          isLoading={Boolean(results[0]?.isLoading)}
          label="当前简历"
          mode={mode}
          slug={slug}
        />
        <ComparisonCard
          candidate={suspected}
          detail={results[1]?.data}
          isError={Boolean(results[1]?.isError)}
          isLoading={Boolean(results[1]?.isLoading)}
          label="疑似简历"
          mode={mode}
          slug={slug}
        />
      </div>
    </Modal>
  );
}
