"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import type { SscResponsibilitySource } from "../ssc-responsibilities/ssc-responsibilities-grid";

interface SscCandidate {
  id: string;
  sscName: string;
  email: string;
  telegram: string;
  workspaceRole: string;
  workspaceRoleName: string;
  registered: boolean;
  assigned: boolean;
}

export function ResumeSourceSscAddDialog({
  source,
  onOpenChange,
  onSaved,
  onPreregister,
}: {
  source: SscResponsibilitySource;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
  onPreregister: () => void;
}) {
  const slug = useWorkspaceSlug();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const candidatesQuery = useQuery({
    queryFn: () =>
      rpcFetch<{ candidates: SscCandidate[] }>(
        rpc.api.w[":slug"].studio["ssc-responsibilities"].candidates.$get({
          param: { slug },
          query: { resumeSourceId: source.id },
        }),
        "加载 SSC 人员失败",
      ),
    queryKey: ["studio-ssc-candidates", slug, source.id],
  });
  const options = useMemo(
    () =>
      (candidatesQuery.data?.candidates ?? []).map((candidate) => ({
        description: [
          candidate.email,
          candidate.workspaceRoleName,
          candidate.registered ? "已注册" : "待注册",
          candidate.assigned ? "已添加" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        disabled: candidate.assigned,
        label: candidate.sscName || candidate.email || candidate.telegram || "待补充",
        searchValue: `${candidate.sscName} ${candidate.email} ${candidate.telegram}`,
        value: candidate.id,
      })),
    [candidatesQuery.data],
  );
  const assignment = useMutation({
    mutationFn: () =>
      rpcFetch(
        rpc.api.w[":slug"].studio["ssc-responsibilities"].assign.$post({
          json: { candidateIds: selectedIds, resumeSourceId: source.id },
          param: { slug },
        }),
        "添加 SSC 失败",
      ),
    onError: (error) => toast.error(error instanceof Error ? error.message : "添加 SSC 失败"),
    onSuccess: async () => {
      toast.success("SSC 已添加");
      onOpenChange(false);
      await onSaved();
    },
  });
  const canAdd =
    selectedIds.length > 0 &&
    !candidatesQuery.isPending &&
    !candidatesQuery.isError &&
    !assignment.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!assignment.isPending) {
          onOpenChange(open);
        }
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>添加 SSC</DialogTitle>
          <DialogDescription>
            为“{source.name}”选择 SSC
            人员，可同时选择已注册成员和预录人员。已添加的人员无需重复选择。
          </DialogDescription>
        </DialogHeader>
        {candidatesQuery.isError ? (
          <div className="grid gap-3 rounded-lg border p-4">
            <p role="alert" className="text-sm text-destructive">
              {candidatesQuery.error instanceof Error
                ? candidatesQuery.error.message
                : "加载 SSC 人员失败，请重试。"}
            </p>
            <Button type="button" variant="outline" onClick={() => void candidatesQuery.refetch()}>
              重新加载
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="ssc-management-add-members">SSC 人员（可多选）</Label>
            <SearchableMultiSelect
              id="ssc-management-add-members"
              value={selectedIds}
              onChange={setSelectedIds}
              options={options}
              showBadges
              disabled={candidatesQuery.isPending || assignment.isPending}
              placeholder={candidatesQuery.isPending ? "加载 SSC 人员中…" : "选择 SSC 人员"}
              searchPlaceholder="搜索花名、邮箱或 TG"
              emptyMessage="暂无可添加的 SSC 人员"
            />
            {!candidatesQuery.isPending && options.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                暂无可添加人员，可先预录新 SSC，并选择已设置的 SSC 审核角色。
              </p>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">人员尚未注册，也可提前录入邮箱。</p>
          <Button
            type="button"
            variant="outline"
            disabled={assignment.isPending}
            onClick={onPreregister}
          >
            预录新 SSC
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={assignment.isPending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              if (canAdd) {
                assignment.mutate();
              }
            }}
          >
            {assignment.isPending ? "添加中…" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
