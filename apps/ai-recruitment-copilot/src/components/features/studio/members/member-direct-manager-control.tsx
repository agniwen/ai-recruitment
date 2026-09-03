import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { customColumn } from "@/components/data-grid";
import type { MemberRow } from "@/components/features/studio/members/members-page-model";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { rpcFetch } from "@/lib/client/api";
import { runAsyncAction } from "@/lib/client/async-control";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

interface WorkspaceMemberHierarchyRow {
  directManagerUserId: string | null;
  userId: string;
}

const EMPTY_MEMBER_HIERARCHY: WorkspaceMemberHierarchyRow[] = [];

export function workspaceMemberHierarchyQueryKey(slug: string) {
  return ["workspace-member-hierarchy", slug] as const;
}

export function useWorkspaceMemberDirectManagerControl(
  canUpdate: boolean,
  members: readonly MemberRow[],
) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const hierarchyQueryKey = workspaceMemberHierarchyQueryKey(slug);
  const query = useQuery({
    queryFn: () =>
      rpcFetch<{ records: WorkspaceMemberHierarchyRow[] }>(
        rpc.api.w[":slug"].studio.workspace.members.hierarchy.$get({ param: { slug } }),
        "加载直属上级关系失败",
      ),
    queryKey: hierarchyQueryKey,
    refetchOnWindowFocus: false,
  });
  const hierarchy = query.data?.records ?? EMPTY_MEMBER_HIERARCHY;
  const directManagerByUserId = useMemo(
    () => new Map(hierarchy.map((row) => [row.userId, row.directManagerUserId])),
    [hierarchy],
  );
  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        avatarUrl: member.image,
        description: member.email,
        label: member.name,
        searchValue: `${member.name} ${member.email}`,
        value: member.userId,
      })),
    [members],
  );

  const changeDirectManager = useCallback(
    async (userId: string, directManagerUserId: string | null) => {
      if (!canUpdate) {
        return;
      }
      if ((directManagerByUserId.get(userId) ?? null) === directManagerUserId) {
        return;
      }
      setPendingUserId(userId);
      await runAsyncAction({
        cleanup: () => setPendingUserId(null),
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : "更新直属上级失败"),
        operation: async () => {
          await rpcFetch<{ success: boolean }>(
            rpc.api.w[":slug"].studio.workspace.members[":userId"]["direct-manager"].$patch({
              json: { directManagerUserId },
              param: { slug, userId },
            }),
            "更新直属上级失败",
          );
          await queryClient.invalidateQueries({ queryKey: hierarchyQueryKey });
          toast.success(directManagerUserId ? "直属上级已更新" : "直属上级已清除");
        },
      });
    },
    [canUpdate, directManagerByUserId, hierarchyQueryKey, queryClient, slug],
  );

  const directManagerColumn = useMemo(
    () =>
      customColumn<MemberRow>({
        cell: (row) => {
          if (query.isPending) {
            return <span className="text-muted-foreground text-sm">加载中…</span>;
          }
          if (query.isError) {
            return <span className="text-destructive text-sm">加载失败</span>;
          }
          return (
            <SearchableSelect
              clearable
              disabled={!canUpdate || pendingUserId === row.userId}
              emptyMessage="没有可选成员"
              onChange={(directManagerUserId) =>
                void changeDirectManager(row.userId, directManagerUserId)
              }
              options={memberOptions.filter((option) => option.value !== row.userId)}
              placeholder="未设置"
              searchPlaceholder="搜索姓名或邮箱…"
              triggerClassName="min-w-48"
              value={directManagerByUserId.get(row.userId) ?? null}
            />
          );
        },
        key: "directManagerUserId",
        size: 220,
        title: "直属上级",
      }),
    [
      canUpdate,
      changeDirectManager,
      directManagerByUserId,
      memberOptions,
      pendingUserId,
      query.isError,
      query.isPending,
    ],
  );

  return { directManagerByUserId, directManagerColumn };
}
