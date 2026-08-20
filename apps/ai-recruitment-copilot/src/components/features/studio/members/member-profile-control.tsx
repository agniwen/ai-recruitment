import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { customColumn } from "@/components/data-grid";
import type { MemberRow } from "@/components/features/studio/members/members-page-model";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

interface WorkspaceMemberProfile {
  telegram: string | null;
  userId: string;
}

const EMPTY_MEMBER_PROFILES: WorkspaceMemberProfile[] = [];

export function useWorkspaceMemberProfileControl(canUpdate: boolean) {
  const slug = useWorkspaceSlug();
  const query = useQuery({
    enabled: canUpdate,
    queryFn: () =>
      rpcFetch<{ records: WorkspaceMemberProfile[] }>(
        rpc.api.w[":slug"].studio.workspace.members.profiles.$get({ param: { slug } }),
        "加载成员资料失败",
      ),
    queryKey: ["workspace-member-profiles", slug],
    refetchOnWindowFocus: false,
  });
  const profiles = query.data?.records ?? EMPTY_MEMBER_PROFILES;
  const profileByUserId = useMemo(
    () => new Map(profiles.map((profile) => [profile.userId, profile])),
    [profiles],
  );
  const telegramColumn = useMemo(
    () =>
      canUpdate && query.isSuccess
        ? customColumn<MemberRow>({
            cell: (row) => (
              <span className="text-muted-foreground text-sm">{row.telegram || "—"}</span>
            ),
            key: "telegram",
            title: "TG 号",
          })
        : null,
    [canUpdate, query.isSuccess],
  );

  return {
    memberProfilesReady: query.isSuccess,
    profileByUserId,
    refetchMemberProfiles: query.refetch,
    telegramColumn,
  };
}
