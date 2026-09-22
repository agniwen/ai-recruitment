import type { MemberOdcScopeInput } from "@arc/db-schema/pre-registration";
import { Button } from "@/components/ui/button";
import { useMemberOdcScopes } from "../members/member-odc-scope-query";
import { MemberOdcScopeReadOnly } from "../members/member-odc-scope-readonly";
import { PreRegistrationOdcFields } from "./pre-registration-odc-fields";

export function usePreRegistrationOdcConfiguration(
  open: boolean,
  email: string,
  isOdc: boolean,
  value: MemberOdcScopeInput,
) {
  const query = useMemberOdcScopes(open);
  const existingMember = query.data?.records.find(
    (row) => row.email.toLowerCase() === email.trim().toLowerCase(),
  );
  const sources = query.data?.sources ?? [];
  const editable = isOdc && !existingMember;
  const valid =
    query.isSuccess &&
    (!editable ||
      value.odcScopeMode === "all" ||
      value.odcAssignments.every((assignment) =>
        sources.some((source) => source.id === assignment.resumeSourceId),
      ));
  return { editable, existingMember, query, sources, valid };
}

export function PreRegistrationOdcConfiguration({
  configuration,
  value,
  disabled,
  onChange,
}: {
  configuration: ReturnType<typeof usePreRegistrationOdcConfiguration>;
  value: MemberOdcScopeInput;
  disabled: boolean;
  onChange: (patch: Partial<MemberOdcScopeInput>) => void;
}) {
  const { editable, existingMember, query, sources } = configuration;
  if (query.isError) {
    return (
      <p role="alert">
        加载成员负责范围失败。
        <Button variant="link" onClick={() => void query.refetch()}>
          重试
        </Button>
      </p>
    );
  }
  if (existingMember) {
    return <MemberOdcScopeReadOnly scope={existingMember} sources={sources} />;
  }
  if (!editable || !query.isSuccess) {
    return null;
  }
  return (
    <PreRegistrationOdcFields
      assignments={value.odcAssignments}
      scopeMode={value.odcScopeMode}
      sources={sources}
      disabled={disabled}
      loading={false}
      failed={false}
      onScopeModeChange={(odcScopeMode) => onChange({ odcScopeMode })}
      onChange={(odcAssignments) => onChange({ odcAssignments })}
    />
  );
}
