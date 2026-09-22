import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { MemberOdcScopeInput } from "@arc/db-schema/pre-registration";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export interface MemberOdcScopeRecord extends MemberOdcScopeInput {
  memberId: string;
  email: string;
  isOdc: boolean;
}

export function useMemberOdcScopes(enabled: boolean) {
  const slug = useWorkspaceSlug();
  return useQuery({
    enabled,
    queryFn: () =>
      rpcFetch<{ records: MemberOdcScopeRecord[]; sources: { id: string; name: string }[] }>(
        rpc.api.w[":slug"].studio.workspace.members["odc-scopes"].$get({ param: { slug } }),
        "加载 ODC 负责范围失败",
      ),
    queryKey: ["member-odc-scopes", slug],
  });
}

export function memberOdcScopeLabel(scope: MemberOdcScopeRecord) {
  if (!scope.isOdc) {
    return "—";
  }
  if (scope.odcScopeMode === "all") {
    return "全部部门/中心（包含以后新增）";
  }
  return `指定 ${scope.odcAssignments.length} 个部门/中心`;
}

export function invalidateOdcScopeQueries(client: QueryClient, slug: string) {
  return Promise.all(
    [
      "member-odc-scopes",
      "resume-sources",
      "odc-management",
      "workspace-members",
      "odc-responsibilities",
      "studio-pre-registrations",
      "ai-review-approvals",
    ].map((key) => client.invalidateQueries({ queryKey: [key, slug] })),
  );
}
