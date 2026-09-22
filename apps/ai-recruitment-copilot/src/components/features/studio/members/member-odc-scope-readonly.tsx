import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { memberOdcScopeLabel } from "./member-odc-scope-query";
import type { MemberOdcScopeRecord } from "./member-odc-scope-query";

export function MemberOdcScopeReadOnly({
  scope,
  sources,
}: {
  scope: MemberOdcScopeRecord;
  sources: { id: string; name: string }[];
}) {
  const slug = useWorkspaceSlug();
  return (
    <Field>
      <FieldLabel>当前 ODC 负责范围</FieldLabel>
      <p className="text-sm">
        {scope.isOdc ? memberOdcScopeLabel(scope) : "该成员当前角色不是 ODC"}
      </p>
      {scope.isOdc && scope.odcScopeMode === "selected" ? (
        <ul className="text-sm">
          {scope.odcAssignments.map((assignment) => (
            <li key={assignment.resumeSourceId}>
              {sources.find((source) => source.id === assignment.resumeSourceId)?.name ??
                "来源已不可用"}
              {` · ${assignment.jobSeries ?? "不限序列"} · ${assignment.serviceUnit ?? "不限服务单位"}`}
            </li>
          ))}
        </ul>
      ) : null}
      <FieldDescription>该人员已加入工作区，负责范围以成员配置为准。</FieldDescription>
      <a className="text-sm underline" href={`/w/${encodeURIComponent(slug)}/studio/members`}>
        前往成员管理
      </a>
    </Field>
  );
}
