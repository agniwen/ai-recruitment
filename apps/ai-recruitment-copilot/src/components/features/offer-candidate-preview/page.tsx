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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchOfferCandidatePreview,
  offerCandidateResumeUrl,
} from "@/lib/client/api/endpoints/offer-candidate-preview";
import { AiReviewDetails, HumanInterviewDetails, OfferDetails } from "./sections";

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
  let resumeAction: ReactNode;
  if (!candidate.hasResumeFile) {
    resumeAction = (
      <Button disabled size="sm" variant="outline">
        打开简历
      </Button>
    );
  } else if (canPreview) {
    resumeAction = (
      <Button onClick={() => setPreviewOpen(true)} size="sm" variant="outline">
        打开简历
      </Button>
    );
  } else {
    resumeAction = (
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
    <>
      <header className="space-y-3">
        <Badge variant="outline">候选人资料 · 只读</Badge>
        <h1 className="wrap-break-word font-semibold text-2xl">{candidate.name}</h1>
        <p className="text-muted-foreground text-sm">{job.name ?? "待识别岗位"}</p>
      </header>

      <Tabs className="gap-6" defaultValue="overview">
        <TabsList aria-label="候选人详情" className="grid w-full grid-cols-4 sm:flex sm:w-fit">
          <TabsTrigger className="min-w-0 px-2 text-sm sm:min-w-[6em]" value="overview">
            概览
          </TabsTrigger>
          <TabsTrigger className="min-w-0 px-2 text-sm sm:min-w-[6em]" value="ai-review">
            AI评分
          </TabsTrigger>
          <TabsTrigger className="min-w-0 px-2 text-sm sm:min-w-[6em]" value="human-interview">
            真人复面
          </TabsTrigger>
          <TabsTrigger className="min-w-0 px-2 text-sm sm:min-w-[6em]" value="offer">
            Offer
          </TabsTrigger>
        </TabsList>
        <TabsContent className="space-y-6" value="overview">
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
          <section aria-labelledby="resume-title" className="rounded-xl border bg-card p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-lg" id="resume-title">
                候选人简历
              </h2>
              <div className="flex flex-wrap gap-2">
                {resumeAction}
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
            {candidate.hasResumeFile ? null : (
              <p className="mb-3 text-muted-foreground text-sm">原始简历暂不可用</p>
            )}
            {candidate.hasResumeFile && !candidate.profile ? (
              <p className="text-muted-foreground text-sm">
                已上传原始简历，点击“打开简历”查看具体内容。
              </p>
            ) : (
              <ResumeProfileView profile={candidate.profile} />
            )}
          </section>
        </TabsContent>
        <TabsContent value="ai-review">
          <AiReviewDetails data={data} />
        </TabsContent>
        <TabsContent value="human-interview">
          <HumanInterviewDetails rounds={data.humanInterviews} />
        </TabsContent>
        <TabsContent value="offer">
          <OfferDetails offer={data.offer} />
        </TabsContent>
      </Tabs>

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
