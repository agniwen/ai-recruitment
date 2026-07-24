"use client";

import { useQuery } from "@tanstack/react-query";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export interface WorkspaceInterviewerMember {
  email: string;
  id: string;
  image: string | null;
  isInterviewer: boolean;
  name: string;
}

export function useWorkspaceInterviewerMembers(enabled = true) {
  const slug = useWorkspaceSlug();
  return useQuery({
    enabled,
    queryFn: async () => {
      const payload = await rpcFetch<{ records: WorkspaceInterviewerMember[] }>(
        rpc.api.w[":slug"].studio.workspace.members.$get({ param: { slug } }),
        "加载真人面试官失败",
      );
      return payload.records.filter((member) => member.isInterviewer);
    },
    queryKey: ["workspace-interviewer-members", slug],
    staleTime: 60_000,
  });
}
