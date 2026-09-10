import type { ResumeSourceRecord } from "@arc/shared/resume-sources";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useHasPermission } from "@/hooks/use-has-permission";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { ResumeSourceFormDialog } from "../resume-sources/resume-source-form-dialog";

const CREATE_SOURCE = "__create_source__";
const CURRENT_SOURCE = "__current_source__";

export function JobDescriptionSourceSelect({
  id,
  value,
  sourceId,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  value: string | null;
  sourceId?: string | null;
  onChange: (value: string | null, sourceId: string | null) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const canCreate = useHasPermission("hiringUnit", "create");
  const [creating, setCreating] = useState(false);
  const sources = useQuery({
    queryFn: () =>
      rpcFetch<{ records: Pick<ResumeSourceRecord, "id" | "name">[] }>(
        rpc.api.w[":slug"].studio["job-descriptions"]["reference-options"].$get({
          param: { slug },
        }),
        "加载部门/中心（来源）失败",
      ),
    queryKey: ["job-description-source-options", slug],
  });
  const records = sources.data?.records ?? [];
  const selected = records.find((source) =>
    sourceId ? source.id === sourceId : source.name === value,
  );
  const options = records.map((source) => ({ label: source.name, value: source.id }));
  if (value && !selected) {
    options.push({ label: value, value: CURRENT_SOURCE });
  }
  if (canCreate && !disabled && sources.isSuccess) {
    options.push({ label: "新建部门/中心（来源）…", value: CREATE_SOURCE });
  }

  return (
    <>
      <SearchableSelect
        clearable
        disabled={disabled || sources.isPending || sources.isError}
        emptyMessage="没有匹配的部门/中心（来源）"
        id={id}
        invalid={invalid}
        onChange={(next) => {
          if (next === CREATE_SOURCE) {
            setCreating(true);
          } else if (next !== CURRENT_SOURCE) {
            const source = records.find((item) => item.id === next);
            onChange(source?.name ?? null, source?.id ?? null);
          }
        }}
        options={options}
        placeholder={sources.isPending ? "加载部门/中心（来源）中…" : "请选择部门/中心（来源）"}
        searchPlaceholder="搜索部门/中心（来源）…"
        value={selected?.id ?? (value ? CURRENT_SOURCE : null)}
      />
      {sources.isError ? (
        <p role="alert" className="text-destructive text-sm">
          加载部门/中心（来源）失败，请重新打开表单重试。
        </p>
      ) : null}
      {canCreate && !disabled ? (
        <ResumeSourceFormDialog
          onOpenChange={setCreating}
          onSaved={(saved) => {
            onChange(saved.name, saved.id);
            void queryClient.invalidateQueries({
              queryKey: ["job-description-source-options", slug],
            });
            void queryClient.invalidateQueries({ queryKey: ["resume-sources", slug] });
          }}
          open={creating}
          record={null}
        />
      ) : null}
    </>
  );
}
