import { useMemo } from "react";
import { customColumn } from "@/components/data-grid";
import { Button } from "@/components/ui/button";
import type { MemberRow } from "./members-page-model";
import { memberOdcScopeLabel, useMemberOdcScopes } from "./member-odc-scope-query";

export function useMemberOdcScopeControl(enabled: boolean) {
  const { data, isError, isPending, refetch } = useMemberOdcScopes(enabled);
  const byMember = useMemo(() => new Map(data?.records.map((row) => [row.memberId, row])), [data]);
  const columns = useMemo(
    () =>
      enabled
        ? [
            customColumn<MemberRow>({
              cell: (row) => {
                if (isError) {
                  return (
                    <Button variant="link" onClick={() => void refetch()}>
                      加载失败，重试
                    </Button>
                  );
                }
                const scope = byMember.get(row.id);
                if (!scope) {
                  return <span>{isPending ? "加载中…" : "—"}</span>;
                }
                return <span>{memberOdcScopeLabel(scope)}</span>;
              },
              key: "odcScope",
              title: "ODC 负责范围",
            }),
          ]
        : [],
    [enabled, byMember, isError, isPending, refetch],
  );
  return { byMember, columns, refetch };
}
