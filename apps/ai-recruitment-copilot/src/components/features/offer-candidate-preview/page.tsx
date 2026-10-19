import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { DataField } from "@/components/features/display/data-field";
import { DataFields } from "@/components/features/display/data-fields";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchOfferCandidatePreview } from "@/lib/client/api/endpoints/offer-candidate-preview";
import { CandidateOverview } from "./overview";
import { AiReviewDetails, HumanInterviewDetails, OfferDetails } from "./sections";

function CandidateDetails({
  data,
  token,
  refreshing,
  onRefresh,
}: {
  data: OfferCandidatePreview;
  token: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  return (
    <>
      <header>
        <h1 className="wrap-break-word font-semibold text-2xl tracking-normal">
          {data.candidate.name}
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">{data.job.name ?? "待识别岗位"}</p>
      </header>
      <Tabs className="gap-5" onValueChange={setActiveTab} value={activeTab}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-border/70 border-b pb-4">
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
          <Button disabled={refreshing} onClick={onRefresh} size="sm" variant="ghost">
            <IconRefresh className={refreshing ? "size-4 animate-spin" : "size-4"} />
            刷新
          </Button>
        </div>
        <TabsContent value="overview">
          <CandidateOverview
            data={data}
            onViewAiScore={() => setActiveTab("ai-review")}
            token={token}
          />
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
      <footer className="border-border/50 border-t pt-5 text-muted-foreground text-xs">
        <p className="mb-2">候选人资料 · 只读</p>
        <DataFields columns={1}>
          <DataField kind="datetime" label="查看链接有效期至" value={data.linkExpiresAt} />
        </DataFields>
      </footer>
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
    content = (
      <CandidateDetails
        data={query.data}
        onRefresh={() => {
          void query.refetch();
        }}
        refreshing={query.isFetching}
        token={token}
      />
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[96rem] flex-col gap-5 px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6">
      {content}
    </main>
  );
}
