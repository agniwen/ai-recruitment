import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { getResumeDocumentKind } from "@arc/shared/resume-documents";
import { useState } from "react";
import type { ReactNode } from "react";
import { DataField } from "@/components/features/display/data-field";
import { DataFields } from "@/components/features/display/data-fields";
import { ResumeDocumentPreviewModal } from "@/components/features/resume/resume-document-preview-modal";
import { ResumeProfileView } from "@/components/features/resume/resume-profile-view";
import { CandidateTimeline } from "@/components/features/studio/candidate-timeline";
import { ResumeOverviewAiScoreSection } from "@/components/features/studio/resumes/resume-overview-panel";
import { Button } from "@/components/ui/button";
import { offerCandidateResumeUrl } from "@/lib/client/api/endpoints/offer-candidate-preview";

function OriginalResume({
  candidate,
  token,
}: {
  candidate: OfferCandidatePreview["candidate"];
  token: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const resumeUrl = offerCandidateResumeUrl(token);
  const kind = getResumeDocumentKind({ fileName: candidate.resumeFileName ?? undefined });
  const canPreview = kind === "pdf" || kind === "image" || kind === "docx" || kind === "xlsx";
  let action: ReactNode;
  if (!candidate.hasResumeFile) {
    action = (
      <Button disabled size="sm" variant="outline">
        打开简历
      </Button>
    );
  } else if (canPreview) {
    action = (
      <Button onClick={() => setPreviewOpen(true)} size="sm" variant="outline">
        打开简历
      </Button>
    );
  } else {
    action = (
      <Button
        nativeButton={false}
        render={
          <a
            download={candidate.resumeFileName ?? "简历"}
            href={resumeUrl}
            referrerPolicy="no-referrer"
          >
            打开简历
          </a>
        }
        size="sm"
        variant="outline"
      />
    );
  }
  return (
    <section className="space-y-4 border-border/50 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-sm">简历文件</h2>
        <div className="flex flex-wrap gap-2">
          {action}
          {candidate.hasResumeFile ? (
            <Button
              nativeButton={false}
              render={
                <a
                  download={candidate.resumeFileName ?? "简历"}
                  href={resumeUrl}
                  referrerPolicy="no-referrer"
                >
                  下载简历
                </a>
              }
              size="sm"
              variant="outline"
            />
          ) : null}
        </div>
      </div>
      <p className="wrap-break-word text-muted-foreground text-sm">
        {candidate.hasResumeFile ? candidate.resumeFileName : "原始简历暂不可用"}
      </p>
      {candidate.hasResumeFile && !candidate.profile ? (
        <p className="text-muted-foreground text-sm">
          已上传原始简历，点击“打开简历”查看具体内容。
        </p>
      ) : (
        <ResumeProfileView profile={candidate.profile} showBasicInfo={false} />
      )}
      {canPreview && candidate.hasResumeFile ? (
        <ResumeDocumentPreviewModal
          downloadUrl={resumeUrl}
          fileName={candidate.resumeFileName}
          onClose={() => setPreviewOpen(false)}
          url={previewOpen ? resumeUrl : null}
        />
      ) : null}
    </section>
  );
}

function CandidateInfo({ data }: { data: OfferCandidatePreview }) {
  const { candidate, job } = data;
  const { info } = candidate;
  return (
    <section className="space-y-6 border-border/50 border-t pt-6">
      <h2 className="font-medium text-sm">候选人信息</h2>
      <DataFields columns={3} density="compact">
        <DataField label="姓名" value={candidate.name || candidate.profile?.name} />
        <DataField label="目标岗位" value={info?.targetRole} valueClassName="font-medium" />
        <DataField label="关联岗位" value={job.name} valueClassName="font-medium" />
        <DataField label="用人组织" value={info?.hiringUnitName} />
        <DataField label="简历来源" value={info?.recruitmentSourceLabel} />
        <DataField
          label="简历评估"
          value={info?.resumeEvaluationLabel}
          valueClassName="font-medium"
        />
        <DataField label="性别" value={candidate.profile?.gender} />
        <DataField kind="number" label="年龄" value={candidate.profile?.age} />
        <DataField kind="number" label="工作年限" value={candidate.profile?.workYears} />
        <DataField kind="email" label="邮箱" value={info?.email ?? candidate.profile?.email} />
        <DataField kind="phone" label="电话" value={info?.phone ?? candidate.profile?.phone} />
        <DataField label="部门 / 中心" value={job.departmentName} />
        <DataField
          label="推荐语"
          span="full"
          value={info?.recommendationText}
          valueClassName="whitespace-pre-wrap"
        />
        <DataField
          label="岗位说明"
          span="full"
          value={job.description}
          valueClassName="whitespace-pre-wrap"
        />
      </DataFields>
    </section>
  );
}

export function CandidateOverview({
  data,
  token,
  onViewAiScore,
}: {
  data: OfferCandidatePreview;
  token: string;
  onViewAiScore: () => void;
}) {
  const events = (data.timeline ?? []).map((event, index) => ({
    ...event,
    actorImage: null,
    description: null,
    id: `activity-${index}`,
  }));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="min-w-0 space-y-8">
        <ResumeOverviewAiScoreSection
          detail={{ resumeReview: data.aiReview.review }}
          onViewAiScore={onViewAiScore}
        />
        <CandidateInfo data={data} />
        <OriginalResume candidate={data.candidate} token={token} />
      </div>
      <aside
        aria-label="候选人活动记录"
        className="min-w-0 max-w-full overflow-hidden xl:sticky xl:top-4 xl:max-h-[70vh] xl:self-start xl:overflow-y-auto"
      >
        <CandidateTimeline
          data={{
            events,
            summary: {
              currentOutcomeLabel: "",
              currentStageLabel: "Offer",
              latestAt: events[0]?.occurredAt ?? null,
              totalEvents: events.length,
            },
          }}
          density="rail"
          isLoading={false}
          scrollMode="page"
        />
      </aside>
    </div>
  );
}
