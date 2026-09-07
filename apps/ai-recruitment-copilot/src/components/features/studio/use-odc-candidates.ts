import type { OdcMemberSummary } from "@arc/shared/hiring-units";
import { useQuery } from "@tanstack/react-query";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function toOdcCandidateOption(
  candidate: OdcMemberSummary,
  disabled = false,
): SearchableSelectOption {
  return {
    avatarUrl: candidate.image,
    description: candidate.email,
    disabled,
    label: candidate.name,
    searchValue: `${candidate.name} ${candidate.email}`,
    value: candidate.memberId,
  };
}

export function useOdcCandidates(enabled: boolean) {
  const slug = useWorkspaceSlug();
  return useQuery({
    enabled,
    queryFn: async () => {
      const payload = await rpcFetch<{ records: OdcMemberSummary[] }>(
        rpc.api.w[":slug"].studio.workspace.members["odc-candidates"].$get({
          param: { slug },
        }),
        "加载 ODC 人员失败",
      );
      return payload.records;
    },
    queryKey: ["workspace-members", slug, "odc-candidates"],
  });
}
