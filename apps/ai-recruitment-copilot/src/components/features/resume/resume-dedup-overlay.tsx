"use client";

/**
 * 简历疑似重复风险提示 overlay / 详情弹窗。
 * Resume duplicate-risk overlay and the "view suspected duplicates" dialog.
 *
 * - ResumeDuplicateMatchesDialog: 简历库 / 简历广场点击「疑似重复」后打开，
 *   左侧当前候选人，右侧疑似列表；优先 PC 对照阅读。
 * - ResumeDedupOverlay: 上传解析后命中查重时的决策面板。
 */

import {
  IconAlertTriangle as AlertTriangleIcon,
  IconChevronRight as ChevronRightIcon,
  IconLoader2 as Loader2Icon,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Suspense, lazy, useState } from "react";
import type { DedupMatchRecord, DedupSourceCandidate } from "@/lib/client/api";
import {
  candidateOutcomeMeta,
  pipelineStageMeta,
  resumeEvaluationStatusMeta,
} from "@arc/db-schema/studio-interviews";
import { formatDate } from "@arc/shared/utils/time";
import { cn } from "@arc/shared/utils";
import { StudioPersonDetailDialog } from "@/components/features/studio/studio-person-detail-dialog";
import { ResumeProfileSnapshotView } from "@/components/features/resume/resume-profile-snapshot";
import { ResumeProfileView } from "@/components/features/resume/resume-profile-view";
import { EmptyValue } from "@/components/features/display/empty-value";
import { ResumeCandidateTitleWithCopyableId } from "@/components/features/resume/copyable-resume-record-id";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { fetchResumePoolItem } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { useHasPermission } from "@/hooks/use-has-permission";

const LEVEL_META: Record<
  NonNullable<DedupMatchRecord["level"]>,
  { label: string; variant: "danger" | "secondary" | "warning" }
> = {
  high: { label: "高度疑似", variant: "danger" },
  low: { label: "低风险", variant: "secondary" },
  medium: { label: "可能重复", variant: "warning" },
};

const SKILLS_PREVIEW_LIMIT = 8;

const ResumeComparisonDialog = lazy(async () => {
  const mod = await import("@/components/features/resume/resume-comparison-dialog");
  return { default: mod.ResumeComparisonDialog };
});

function formatCreatedAt(value: string) {
  return formatDate(value);
}

function formatSimilarity(value: number | undefined): string | null {
  if (typeof value !== "number") {
    return null;
  }
  return `${Math.round(value * 100)}%`;
}

function similarityEvidence(match: DedupMatchRecord): { label: string; value: string }[] {
  return [
    { label: "工作/项目", value: formatSimilarity(match.similarity?.workProject) },
    { label: "整体画像", value: formatSimilarity(match.similarity?.resumeOverview) },
    { label: "技能岗位", value: formatSimilarity(match.similarity?.skillRole) },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value));
}

function sourceTypeLabel(match: Pick<DedupMatchRecord, "sourceType">) {
  return match.sourceType === "resume_pool_item" ? "私有简历池" : "候选人管理";
}

function textOrNull(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function recruitmentStageLabel(candidate: DedupMatchRecord | DedupSourceCandidate): string {
  if (candidate.pipelineStage === "closed") {
    return candidate.outcome && candidate.outcome !== "in_pipeline"
      ? candidateOutcomeMeta[candidate.outcome].label
      : pipelineStageMeta.closed.label;
  }
  if (candidate.pipelineStage === "screening") {
    const evaluation = candidate.resumeEvaluationStatus
      ? resumeEvaluationStatusMeta[candidate.resumeEvaluationStatus].label
      : "待评估";
    return `${pipelineStageMeta.screening.label} · ${evaluation}`;
  }
  if (candidate.pipelineStage) {
    return pipelineStageMeta[candidate.pipelineStage].label;
  }
  if (candidate.status === "archived") {
    return "已归档";
  }
  return candidate.sourceType === "resume_pool_item" ? "人才库" : "未知环节";
}

function RecruitmentContext({ candidate }: { candidate: DedupMatchRecord | DedupSourceCandidate }) {
  const fields = [
    { label: "用人组织", value: textOrNull(candidate.hiringUnitName) },
    { label: "部门/中心（来源）", value: textOrNull(candidate.resumeSourceName) },
    { label: "部门", value: textOrNull(candidate.departmentName) },
  ];
  let stageMeta = candidate.pipelineStage
    ? pipelineStageMeta[candidate.pipelineStage]
    : pipelineStageMeta.closed;
  if (
    candidate.pipelineStage === "closed" &&
    candidate.outcome &&
    candidate.outcome !== "in_pipeline"
  ) {
    stageMeta = candidateOutcomeMeta[candidate.outcome];
  }

  return (
    <section aria-label="投递去向" className="rounded-lg bg-muted/60 p-4">
      <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 @min-[42rem]:grid-cols-4">
        {fields.map(({ label, value }) => (
          <div className="min-w-0 space-y-1.5" key={label}>
            <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-base font-semibold leading-6 text-foreground">
              {value ?? <EmptyValue />}
            </dd>
          </div>
        ))}
        <div className="min-w-0 space-y-1.5">
          <dt className="text-xs leading-5 text-muted-foreground">当前环节</dt>
          <dd>
            <Badge
              className="max-w-full whitespace-normal text-sm font-semibold"
              variant={stageMeta.tone}
            >
              {recruitmentStageLabel(candidate)}
            </Badge>
          </dd>
        </div>
      </dl>
      <p className="mt-3 min-w-0 break-words text-sm leading-5">
        <span className="me-2 text-xs text-muted-foreground">投递岗位</span>
        {textOrNull(candidate.jobDescriptionName) ?? <EmptyValue />}
      </p>
    </section>
  );
}

function FieldLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 text-xs leading-5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-foreground">{value}</span>
    </div>
  );
}

function SkillsLine({ skills }: { skills: string[] | null | undefined }) {
  if (!skills || skills.length === 0) {
    return null;
  }
  const visible = skills.slice(0, SKILLS_PREVIEW_LIMIT);
  const hiddenCount = skills.length - visible.length;
  return (
    <FieldLine
      label="技能"
      value={
        <span className="line-clamp-2">
          {visible.join("、")}
          {hiddenCount > 0 ? ` 等 ${skills.length} 项` : ""}
        </span>
      }
    />
  );
}

function ContactFields({
  email,
  phone,
}: {
  email: string | null | undefined;
  phone: string | null | undefined;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <FieldLine label="邮箱" value={textOrNull(email) ?? <EmptyValue />} />
      <FieldLine label="手机" value={textOrNull(phone) ?? <EmptyValue />} />
    </div>
  );
}

function UploaderMeta({
  image,
  name,
}: {
  image: string | null | undefined;
  name: string | null | undefined;
}) {
  const displayName = textOrNull(name) ?? "未知上传人";
  return (
    <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 text-xs leading-5">
      <span className="shrink-0 text-muted-foreground">上传人</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <Avatar className="size-4 shrink-0">
          {image ? <AvatarImage alt={displayName} src={image} /> : null}
          <AvatarFallback className="text-[8px]">
            {textOrNull(name)?.charAt(0).toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate text-foreground">{displayName}</span>
      </div>
    </div>
  );
}

function JudgmentLines({ match }: { match: DedupMatchRecord }) {
  const evidence = similarityEvidence(match);
  const reasons = match.semanticReasons ?? [];
  const conflicts = match.conflictingSignals ?? [];
  if (reasons.length === 0 && evidence.length === 0 && conflicts.length === 0) {
    return null;
  }

  const similarityText = evidence.map((item) => `${item.label} ${item.value}`).join(" · ");

  return (
    <div className="min-w-0 space-y-1 text-xs leading-5">
      {reasons.length > 0 ? (
        <FieldLine
          label="依据"
          value={<span className="line-clamp-2">{reasons.join("；")}</span>}
        />
      ) : null}
      {similarityText ? <FieldLine label="相似" value={similarityText} /> : null}
      {conflicts.length > 0 ? (
        <FieldLine
          label="差异"
          value={<span className="text-amber-800 dark:text-amber-200">{conflicts.join("、")}</span>}
        />
      ) : null}
    </div>
  );
}

function CandidateIdentity({
  name,
  id,
  trailing,
}: {
  name: string;
  id: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <h3 className="min-w-0 font-medium text-sm leading-6">
        <ResumeCandidateTitleWithCopyableId id={id} name={name} />
      </h3>
      {trailing}
    </div>
  );
}

function CandidateBody({
  candidate,
  targetRole,
  email,
  phone,
  createdAt,
  skills,
  snapshot,
  uploaderImage,
  uploaderName,
  footer,
}: {
  candidate: DedupMatchRecord | DedupSourceCandidate;
  targetRole: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  createdAt?: string | null;
  skills: string[] | null | undefined;
  snapshot: DedupMatchRecord["resumeProfileSnapshot"];
  uploaderImage: string | null | undefined;
  uploaderName: string | null | undefined;
  footer?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-3">
      <RecruitmentContext candidate={candidate} />
      <div className="grid min-w-0 gap-3 @min-[36rem]:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <UploaderMeta image={uploaderImage} name={uploaderName} />
          {createdAt ? <FieldLine label="创建" value={formatCreatedAt(createdAt)} /> : null}
        </div>
        <ContactFields email={email} phone={phone} />
      </div>
      {footer}
      <details className="group/resume-summary min-w-0 border-t border-border/60 pt-2">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            aria-hidden
            className="size-4 shrink-0 group-open/resume-summary:rotate-90"
          />
          简历摘要与技能
        </summary>
        <div className="space-y-3 pt-3">
          <FieldLine label="求职意向" value={textOrNull(targetRole) ?? <EmptyValue />} />
          <ResumeProfileSnapshotView showLabels snapshot={snapshot} />
          <SkillsLine skills={skills} />
        </div>
      </details>
    </div>
  );
}

function ResumePoolMatchDetailDialog({
  onOpenChange,
  open,
  recordId,
}: {
  open: boolean;
  recordId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const slug = useWorkspaceSlug();
  const detailQuery = useQuery({
    enabled: open && Boolean(recordId),
    queryFn: () => (recordId ? fetchResumePoolItem(slug, recordId) : null),
    queryKey: ["resume-pool", "dedup-match-detail", slug, recordId],
  });
  const detail = detailQuery.data ?? null;
  let content: ReactNode = <p className="text-muted-foreground text-sm">未找到这份私有简历池。</p>;
  if (detailQuery.isLoading) {
    content = (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        正在加载简历详情
      </div>
    );
  } else if (detail) {
    content = (
      <div className="space-y-5">
        <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">目标岗位</span>
            <p className="mt-1 font-medium">{detail.targetRole ?? <EmptyValue />}</p>
          </div>
          <div>
            <span className="text-muted-foreground">邮箱</span>
            <p className="mt-1 break-all font-medium">{detail.candidateEmail ?? <EmptyValue />}</p>
          </div>
          <div>
            <span className="text-muted-foreground">电话</span>
            <p className="mt-1 break-all font-medium">{detail.candidatePhone ?? <EmptyValue />}</p>
          </div>
          <div>
            <span className="text-muted-foreground">状态</span>
            <p className="mt-1 font-medium">{detail.status === "active" ? "有效" : "已归档"}</p>
          </div>
        </div>
        <ResumeProfileView profile={detail.resumeProfile ?? null} />
      </div>
    );
  }

  return (
    <Modal
      description={detail?.resumeFileName ?? undefined}
      onOpenChange={onOpenChange}
      open={open}
      size="2xl"
      title={
        detail ? (
          <ResumeCandidateTitleWithCopyableId id={detail.id} name={detail.candidateName} />
        ) : (
          "私有简历池详情"
        )
      }
    >
      {content}
    </Modal>
  );
}

function SourceCandidatePanel({ source }: { source: DedupSourceCandidate }) {
  return (
    <aside className="@container min-h-0 min-w-0">
      <div className="mb-3 text-sm font-semibold text-primary">本次投递</div>
      <CandidateIdentity id={source.id} name={source.candidateName} />
      <div className="mt-2">
        <CandidateBody
          candidate={source}
          createdAt={source.createdAt}
          email={source.candidateEmail}
          phone={source.candidatePhone}
          skills={source.skills}
          snapshot={source.resumeProfileSnapshot}
          targetRole={source.targetRole}
          uploaderImage={source.uploaderImage}
          uploaderName={source.uploaderName}
        />
      </div>
    </aside>
  );
}

function MatchCandidateRow({
  match,
  onOpenDetail,
  onOpenResume,
}: {
  match: DedupMatchRecord;
  onOpenDetail?: (match: DedupMatchRecord) => void;
  onOpenResume?: (match: DedupMatchRecord) => void;
}) {
  return (
    <article
      aria-label={`${match.candidateName}的疑似历史投递`}
      className="@container min-w-0 rounded-xl border bg-card p-4"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 font-medium text-sm leading-6">
              <ResumeCandidateTitleWithCopyableId id={match.id} name={match.candidateName} />
            </h3>
            {match.level ? (
              <Badge variant={LEVEL_META[match.level].variant}>
                {LEVEL_META[match.level].label}
                {typeof match.score === "number" ? ` ${match.score}%` : ""}
              </Badge>
            ) : null}
            <span className="text-muted-foreground text-[11px]">{sourceTypeLabel(match)}</span>
          </div>
        </div>
        {onOpenDetail || onOpenResume ? (
          <div className="hidden shrink-0 items-center gap-1 lg:flex">
            {onOpenDetail ? (
              <Button
                className="hidden lg:inline-flex"
                onClick={() => onOpenDetail(match)}
                size="sm"
                type="button"
                variant="ghost"
              >
                查看
              </Button>
            ) : null}
            {onOpenResume ? (
              <Button
                className="hidden lg:inline-flex"
                onClick={() => onOpenResume(match)}
                size="sm"
                type="button"
                variant="ghost"
              >
                简历
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 min-w-0">
        <CandidateBody
          candidate={match}
          createdAt={match.createdAt}
          email={match.candidateEmail}
          footer={<JudgmentLines match={match} />}
          phone={match.candidatePhone}
          skills={match.skills}
          snapshot={match.resumeProfileSnapshot}
          targetRole={match.targetRole}
          uploaderImage={match.uploaderImage}
          uploaderName={match.uploaderName}
        />
      </div>
    </article>
  );
}

export function ResumeDedupMatchList({
  matches,
  className,
  source,
}: {
  matches: DedupMatchRecord[];
  className?: string;
  source?: DedupSourceCandidate | null;
}) {
  const canReadResumeLibrary = useHasPermission("resumeLibrary", "read");
  const canReadResumePool = useHasPermission("resumePool", "read");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);
  const [poolDetailOpen, setPoolDetailOpen] = useState(false);
  const [poolDetailRecordId, setPoolDetailRecordId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{
    match: DedupMatchRecord;
    mode: "details" | "documents";
  } | null>(null);

  function openDetail(match: DedupMatchRecord) {
    if (source) {
      setComparison({ match, mode: "details" });
      return;
    }
    if (match.sourceType === "resume_pool_item") {
      setPoolDetailRecordId(match.id);
      setPoolDetailOpen(true);
      return;
    }
    setDetailRecordId(match.id);
    setDetailOpen(true);
  }

  function openResume(match: DedupMatchRecord) {
    if (source) {
      setComparison({ match, mode: "documents" });
    }
  }

  function canReadSourceType(sourceType: DedupMatchRecord["sourceType"]) {
    return sourceType === "resume_pool_item" ? canReadResumePool : canReadResumeLibrary;
  }

  const canReadCurrent = source ? canReadSourceType(source.sourceType) : true;

  return (
    <>
      <div className={cn("min-h-0 space-y-4 overflow-y-auto", className)}>
        {matches.map((match) => {
          const canReadMatch = !source || (canReadCurrent && canReadSourceType(match.sourceType));
          return (
            <MatchCandidateRow
              key={match.id}
              match={match}
              onOpenDetail={canReadMatch ? openDetail : undefined}
              onOpenResume={source && canReadMatch ? openResume : undefined}
            />
          );
        })}
      </div>

      <StudioPersonDetailDialog
        mode="resume"
        onOpenChange={setDetailOpen}
        open={detailOpen}
        recordId={detailRecordId}
      />
      <ResumePoolMatchDetailDialog
        onOpenChange={(open) => {
          setPoolDetailOpen(open);
          if (!open) {
            setPoolDetailRecordId(null);
          }
        }}
        open={poolDetailOpen}
        recordId={poolDetailRecordId}
      />
      {source && comparison ? (
        <Suspense fallback={null}>
          <ResumeComparisonDialog
            current={source}
            mode={comparison.mode}
            onOpenChange={(open) => {
              if (!open) {
                setComparison(null);
              }
            }}
            open
            suspected={comparison.match}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export function ResumeDuplicateMatchesDialog({
  isError = false,
  isLoading = false,
  matches,
  onOpenChange,
  open,
  source = null,
  title = "疑似重复简历",
}: {
  open: boolean;
  matches: DedupMatchRecord[];
  isLoading?: boolean;
  isError?: boolean;
  source?: DedupSourceCandidate | null;
  title?: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  let content: ReactNode = (
    <p className="text-muted-foreground text-sm">请联系管理员核实重复情况</p>
  );

  if (isLoading) {
    content = (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        正在加载疑似重复简历
      </div>
    );
  } else if (isError) {
    content = <p className="py-8 text-center text-destructive text-sm">疑似重复简历加载失败。</p>;
  } else if (matches.length > 0 || source) {
    content = (
      <div className="flex min-h-0 flex-col gap-5 lg:flex-1 lg:flex-row">
        {source ? (
          <div className="min-h-0 shrink-0 lg:w-80 lg:overflow-y-auto lg:border-e lg:border-border/70 lg:pe-5 xl:w-96">
            <SourceCandidatePanel source={source} />
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-3 flex shrink-0 items-center gap-2 text-sm font-semibold">
            疑似历史投递
            <span className="text-muted-foreground font-normal">{matches.length} 条</span>
          </div>

          {matches.length > 0 ? (
            <ResumeDedupMatchList
              className="shrink-0 overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
              matches={matches}
              source={source}
            />
          ) : (
            <p className="py-10 text-center text-muted-foreground text-sm">
              请联系管理员核实重复情况
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Modal
      className="h-[min(90dvh,900px)] max-h-[90dvh]"
      bodyClassName="flex min-w-0 flex-col overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere] lg:overflow-hidden"
      description="先核对历史投递的组织、来源、部门和当前环节，再结合联系方式与简历摘要确认是否为同一人。"
      onOpenChange={onOpenChange}
      open={open}
      size="full"
      title={title}
    >
      {content}
    </Modal>
  );
}

interface ResumeDedupOverlayProps {
  matches: DedupMatchRecord[];
  onContinue: () => void;
  onCancel: () => void;
}

export function ResumeDedupOverlay({ matches, onContinue, onCancel }: ResumeDedupOverlayProps) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangleIcon className="mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-sm">检测到 {matches.length} 条疑似重复的候选人记录</p>
          <p className="text-xs leading-normal opacity-80">
            系统会基于工作经历、项目经历、技能和岗位画像的语义相似度判断风险。
            请根据判断依据确认是否为同一候选人，再决定查看已有记录或继续创建。
          </p>
        </div>
      </div>

      <ResumeDedupMatchList className="max-h-[min(52vh,520px)]" matches={matches} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="outline">
          取消上传
        </Button>
        <Button onClick={onContinue} type="button">
          仍然继续
        </Button>
      </div>
    </div>
  );
}
