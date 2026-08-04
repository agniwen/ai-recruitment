import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { customColumn } from "@/components/data-grid";
import type { MemberRow } from "@/components/features/studio/members/members-page-model";
import { Switch } from "@/components/ui/switch";
import { rpcFetch } from "@/lib/client/api";
import { runAsyncAction } from "@/lib/client/async-control";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

interface WorkspaceMemberMeta {
  email: string;
  id: string;
  image: string | null;
  isInterviewer: boolean;
  name: string;
}

const EMPTY_WORKSPACE_MEMBER_META: WorkspaceMemberMeta[] = [];

interface ChangeMemberInterviewerInput {
  currentValue: boolean;
  nextValue: boolean;
  userId: string;
}

function MemberInterviewerSwitch({
  canUpdate,
  checked,
  name,
  onCheckedChange,
  pending,
}: {
  canUpdate: boolean;
  checked: boolean;
  name: string;
  onCheckedChange: (checked: boolean) => void;
  pending: boolean;
}) {
  return (
    <div className="flex justify-center">
      <Switch
        aria-label={`设置 ${name} 为真人面试官`}
        checked={checked}
        disabled={!canUpdate || pending}
        onCheckedChange={onCheckedChange}
        size="sm"
      />
    </div>
  );
}

function createMemberInterviewerColumn({
  canUpdate,
  changeMemberInterviewer,
  pendingUserId,
}: {
  canUpdate: boolean;
  changeMemberInterviewer: (input: ChangeMemberInterviewerInput) => void;
  pendingUserId: string | null;
}) {
  return customColumn<MemberRow>({
    cell: (row) => (
      <MemberInterviewerSwitch
        canUpdate={canUpdate}
        checked={row.isInterviewer}
        name={row.name}
        onCheckedChange={(nextValue) =>
          changeMemberInterviewer({
            currentValue: row.isInterviewer,
            nextValue,
            userId: row.userId,
          })
        }
        pending={pendingUserId === row.userId}
      />
    ),
    key: "isInterviewer",
    size: 140,
    title: "真人面试官",
  });
}

export function useWorkspaceMemberInterviewerControl(canUpdate: boolean) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const { data } = useQuery({
    queryFn: () =>
      rpcFetch<{ records: WorkspaceMemberMeta[] }>(
        rpc.api.w[":slug"].studio.workspace.members.$get({ param: { slug } }),
        "加载成员列表失败",
      ),
    queryKey: ["workspace-members", slug],
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const members = data?.records ?? EMPTY_WORKSPACE_MEMBER_META;
  const isInterviewerByUserId = useMemo(
    () => new Map(members.map((member) => [member.id, member.isInterviewer])),
    [members],
  );

  const changeMemberInterviewer = useCallback(
    async ({ currentValue, nextValue, userId }: ChangeMemberInterviewerInput) => {
      if (currentValue === nextValue) {
        return;
      }
      setPendingUserId(userId);
      await runAsyncAction({
        cleanup: () => setPendingUserId(null),
        onError: () => toast.error("更新面试官身份失败"),
        operation: async () => {
          await rpcFetch<{ success: boolean }>(
            rpc.api.w[":slug"].studio.workspace.members[":userId"].interviewer.$patch({
              json: { isInterviewer: nextValue },
              param: { slug, userId },
            }),
            "更新面试官身份失败",
          );
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["workspace-members", slug] }),
            queryClient.invalidateQueries({
              queryKey: ["workspace-interviewer-members", slug],
            }),
          ]);
          toast.success(nextValue ? "已设为真人面试官" : "已取消真人面试官身份");
        },
      });
    },
    [queryClient, slug],
  );
  const interviewerColumn = useMemo(
    () =>
      createMemberInterviewerColumn({
        canUpdate,
        changeMemberInterviewer,
        pendingUserId,
      }),
    [canUpdate, changeMemberInterviewer, pendingUserId],
  );

  return { interviewerColumn, isInterviewerByUserId };
}
