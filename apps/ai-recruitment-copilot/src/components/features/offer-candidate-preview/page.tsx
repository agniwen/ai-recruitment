import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { getResumeDocumentKind } from "@arc/shared/resume-documents";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { DataField } from "@/components/features/display/data-field";
import { DataFields } from "@/components/features/display/data-fields";
import { ResumeDocumentPreviewModal } from "@/components/features/resume/resume-document-preview-modal";
import { ResumeProfileView } from "@/components/features/resume/resume-profile-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchOfferCandidatePreview,
  offerCandidateResumeUrl,
} from "@/lib/client/api/endpoints/offer-candidate-preview";

const SSC_STATUS_LABELS = {
  completed: "已完成 SSC 确认",
  confirming: "确认中",
  pending: "待 SSC 接收",
} as const;

function salary(value: number | null, currency: string) {
  return value === null ? null : `${currency} ${value.toLocaleString("zh-CN")}`;
}

function OfferDetails({ offer }: { offer: OfferCandidatePreview["offer"] }) {
  return (
    <section aria-labelledby="offer-title" className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-lg" id="offer-title">
          本次 Offer · v{offer.version}
        </h2>
        <Badge variant="outline">{SSC_STATUS_LABELS[offer.sscConfirmationStatus]}</Badge>
      </div>
      <DataFields columns={2}>
        <DataField label="Offer 职位" value={offer.position} />
        <DataField label="Base 月薪" value={salary(offer.baseSalary, offer.currency)} />
        <DataField label="年度奖金" value={salary(offer.bonus, offer.currency)} />
        <DataField label="股权" value={offer.equity} />
        <DataField kind="date" label="预计入职日期" value={offer.joiningDate} />
        <DataField kind="datetime" label="Offer 有效期至" value={offer.expiresAt} />
        <DataField kind="datetime" label="SSC 接收时间" value={offer.sscReceivedAt} />
        <DataField kind="datetime" label="SSC 完成时间" value={offer.sscCompletedAt} />
        <DataField
          label="备注"
          span="full"
          value={offer.notes}
          valueClassName="whitespace-pre-wrap"
        />
      </DataFields>
    </section>
  );
}

function CandidateDetails({ data, token }: { data: OfferCandidatePreview; token: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { candidate, job } = data;
  const resumeUrl = offerCandidateResumeUrl(token);
  const resumeKind = getResumeDocumentKind({ fileName: candidate.resumeFileName ?? undefined });
  const canPreview =
    resumeKind === "pdf" ||
    resumeKind === "image" ||
    resumeKind === "docx" ||
    resumeKind === "xlsx";

  return (
    <>
      <header className="space-y-3">
        <Badge variant="outline">候选人资料 · 只读</Badge>
        <h1 className="wrap-break-word font-semibold text-2xl">{candidate.name}</h1>
        <p className="text-muted-foreground text-sm">候选人简历、应聘岗位与本次 Offer 信息</p>
      </header>

      <section aria-labelledby="job-title" className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="mb-5 font-semibold text-lg" id="job-title">
          应聘岗位
        </h2>
        <DataFields columns={2}>
          <DataField label="岗位名称" value={job.name} />
          <DataField label="部门 / 中心" value={job.departmentName} />
          <DataField
            label="岗位说明"
            span="full"
            value={job.description}
            valueClassName="whitespace-pre-wrap"
          />
        </DataFields>
      </section>

      <OfferDetails offer={data.offer} />

      <section aria-labelledby="resume-title" className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-lg" id="resume-title">
            候选人简历
          </h2>
          {candidate.hasResumeFile ? (
            <div className="flex flex-wrap gap-2">
              {canPreview ? (
                <Button onClick={() => setPreviewOpen(true)} size="sm" variant="outline">
                  查看原始简历
                </Button>
              ) : null}
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
            </div>
          ) : null}
        </div>
        <ResumeProfileView profile={candidate.profile} />
      </section>

      <div className="text-muted-foreground text-xs">
        <DataFields columns={1}>
          <DataField kind="datetime" label="查看链接有效期至" value={data.linkExpiresAt} />
        </DataFields>
      </div>
      {canPreview && candidate.hasResumeFile ? (
        <ResumeDocumentPreviewModal
          downloadUrl={resumeUrl}
          fileName={candidate.resumeFileName}
          onClose={() => setPreviewOpen(false)}
          url={previewOpen ? resumeUrl : null}
        />
      ) : null}
    </>
  );
}

export function OfferCandidatePreviewPage({ token }: { token: string }) {
  const query = useQuery({
    gcTime: 0,
    queryFn: () => fetchOfferCandidatePreview(token),
    queryKey: ["offer-candidate-preview", token],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  });

  let content: ReactNode;
  if (query.isPending) {
    content = (
      <output className="py-16 text-center text-muted-foreground text-sm">
        正在加载候选人详情…
      </output>
    );
  } else if (query.isError || !query.data) {
    content = (
      <section className="space-y-3 rounded-xl border p-6 text-center" role="alert">
        <h1 className="font-semibold text-lg">链接已失效或不可用</h1>
        <p className="text-muted-foreground text-sm">请联系发送人获取新的候选人详情链接。</p>
      </section>
    );
  } else {
    content = <CandidateDetails data={query.data} token={token} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10">
      {content}
    </main>
  );
}
