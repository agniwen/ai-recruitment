import { AiReviewApprovalButton } from "./ai-review-approval-button";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ResumeLibraryDetail } from "@arc/shared/studio-resumes";
import { resumeReviewStatusMeta } from "@arc/db-schema/studio-interviews";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { ResumeOverviewPanel, ResumeReviewStructuredView } from "../resumes/resume-overview-panel";

export function AiReviewDetailDialog({
  recordId,
  initialTab,
  onClose,
  onApproved,
}: {
  recordId: string;
  initialTab: "overview" | "ai-review";
  onClose: () => void;
  onApproved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(initialTab);
  const detailQuery = useQuery({
    queryFn: ({ signal }) =>
      rpcFetch<ResumeLibraryDetail>(
        rpc.api.w[":slug"].studio["ai-review"][":id"].$get(
          { param: { id: recordId, slug } },
          { init: { signal } },
        ),
        "加载审批详情失败",
      ),
    queryKey: ["ai-review-approvals", slug, "detail", recordId],
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.resumeReviewStatus ?? "") ? 5000 : false,
  });
  const approval = useMutation({
    mutationFn: (approvalNote: string) =>
      rpcFetch(
        rpc.api.w[":slug"].studio["ai-review"][":id"].approve.$post({
          json: { approvalNote },
          param: { id: recordId, slug },
        }),
        "审批失败",
      ),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "审批失败");
      void detailQuery.refetch();
    },
    onSuccess: async () => {
      toast.success("审批通过，已进入简历筛选");
      onApproved();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-review-approvals", slug] }),
        queryClient.invalidateQueries({ queryKey: ["studio-resumes"] }),
      ]);
    },
  });
  const detail = detailQuery.data;
  let body = <Skeleton className="h-80 w-full" />;
  if (detail) {
    body = (
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">候选人概览</TabsTrigger>
          <TabsTrigger value="ai-review">AI 评价</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <ResumeOverviewPanel detail={detail} onViewAiScore={() => setTab("ai-review")} />
        </TabsContent>
        <TabsContent value="ai-review">
          {detail.resumeReviewStatus === "ready" ? (
            <ResumeReviewStructuredView review={detail.resumeReview} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{resumeReviewStatusMeta[detail.resumeReviewStatus].label}</EmptyTitle>
                <EmptyDescription>AI 评价生成完成后才能审批，请稍后刷新查看。</EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={() => void detailQuery.refetch()}>
                刷新
              </Button>
            </Empty>
          )}
        </TabsContent>
      </Tabs>
    );
  }
  if (detailQuery.isError) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>无法加载待审简历</EmptyTitle>
          <EmptyDescription>{detailQuery.error.message}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => void detailQuery.refetch()}>
          重试
        </Button>
      </Empty>
    );
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !approval.isPending) {
          onClose();
        }
      }}
      title={detail ? `${detail.candidateName} · AI 分析审批` : "AI 分析审批"}
      size="full"
      dismissible={!approval.isPending}
      footer={
        <div className="flex w-full items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {detail?.canApproveAiReview
              ? "确认 AI 评价后，审批通过即可进入简历筛选。"
              : "审批需具备该简历来源的 AI 评价审批权限。"}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" disabled={approval.isPending} onClick={onClose}>
              关闭
            </Button>
            {detail?.canApproveAiReview && !detailQuery.isError ? (
              <AiReviewApprovalButton
                disabled={approval.isPending || detail.resumeReviewStatus !== "ready"}
                onConfirm={(note) => approval.mutateAsync(note)}
              />
            ) : null}
          </div>
        </div>
      }
    >
      {body}
    </Modal>
  );
}
