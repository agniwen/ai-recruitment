"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import { authClient } from "@/lib/client/auth-client";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useOptionalWorkspaceMemberRole, useWorkspaceSlug } from "@/lib/client/workspace-context";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function ContinueRecommendation({ record }: { record: ResumeLibraryListRecord }) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const continuation = useMutation({
    mutationFn: async () =>
      await rpcFetch<{ analysisQueued: boolean; status: "accepted" }>(
        rpc.api.w[":slug"].studio.resumes[":id"].protection.continue.$post({
          json: { confirmed: true },
          param: { id: record.id, slug },
        }),
        "继续推荐失败，请重试。",
      ),
    onError: (error) => toast.error(error.message),
    onSuccess: async (result) => {
      setOpen(false);
      if (result.analysisQueued) {
        toast.success("已继续推荐，正在分析。");
      } else {
        toast.error("已继续推荐，分析暂未启动，请在 AI 评分中重新评估。");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["studio-resumes", slug] }),
        queryClient.invalidateQueries({ queryKey: ["studio-resume-metrics", slug] }),
        queryClient.invalidateQueries({ queryKey: ["resume-protection", slug, record.id] }),
      ]);
    },
  });
  const activeProtection =
    record.resumeProtection && new Date(record.resumeProtection.expiresAt).getTime() > Date.now();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        继续推荐
      </Button>
      <AlertDialog
        onOpenChange={(next) => {
          if (!continuation.isPending) {
            setOpen(next);
          }
        }}
        open={open}
      >
        <AlertDialogContent className="resume-protection-detail">
          <AlertDialogHeader>
            <AlertDialogTitle>继续推荐</AlertDialogTitle>
            <AlertDialogDescription>
              {activeProtection
                ? `${record.candidateName}仍处于${record.resumeProtection?.ownerName}的推荐保护期。确认后将继续推荐并开始分析。`
                : `确认后将继续推荐${record.candidateName}并开始分析。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={continuation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={continuation.isPending}
              onClick={() => continuation.mutate()}
            >
              {continuation.isPending ? "提交中…" : "确认继续推荐"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ResumeProtectionContinueButton({ record }: { record: ResumeLibraryListRecord }) {
  const canCreate = useHasPermission("resumeLibrary", "create");
  const role = useOptionalWorkspaceMemberRole();
  const { data: session } = authClient.useSession();
  if (
    !canCreate ||
    record.resumeAdmissionStatus !== "protected" ||
    record.resumeParseStatus !== "ready" ||
    record.outcome !== "in_pipeline" ||
    record.pipelineStage === "closed" ||
    !session?.user.id ||
    (record.createdBy !== session.user.id && role !== "owner" && role !== "admin")
  ) {
    return null;
  }
  return <ContinueRecommendation record={record} />;
}
