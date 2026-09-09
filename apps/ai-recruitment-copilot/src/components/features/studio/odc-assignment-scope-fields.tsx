import type { OdcJobSeries, OdcMemberSummary } from "@arc/shared/hiring-units";
import { Input } from "@/components/ui/input";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { OdcAssignmentDraft } from "./odc-assignment-draft";

const ALL_JOB_SERIES = "__all__";

export function OdcAssignmentScopeFields({
  assignments,
  candidates,
  disabled,
  onChange,
}: {
  assignments: OdcAssignmentDraft[];
  candidates: OdcMemberSummary[];
  disabled: boolean;
  onChange: (assignments: OdcAssignmentDraft[]) => void;
}) {
  if (assignments.length === 0) {
    return null;
  }

  function updateAssignment(memberId: string, patch: Partial<OdcAssignmentDraft>) {
    onChange(
      assignments.map((assignment) =>
        assignment.memberId === memberId ? { ...assignment, ...patch } : assignment,
      ),
    );
  }

  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
      {assignments.map((assignment) => {
        const candidate = candidates.find((item) => item.memberId === assignment.memberId);
        const fieldPrefix = `odc-scope-${assignment.memberId}`;
        return (
          <div className="space-y-3 rounded-md border p-3" key={assignment.memberId}>
            <div className="text-sm font-medium">
              {candidate?.name ?? assignment.memberId}
              {candidate?.email ? (
                <span className="ml-2 font-normal text-muted-foreground">{candidate.email}</span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${fieldPrefix}-job-series`}>序列（非必填）</FieldLabel>
                <FieldContent>
                  <Select
                    disabled={disabled}
                    onValueChange={(value) =>
                      updateAssignment(assignment.memberId, {
                        jobSeries: value === ALL_JOB_SERIES ? null : (value as OdcJobSeries),
                      })
                    }
                    value={assignment.jobSeries ?? ALL_JOB_SERIES}
                  >
                    <SelectTrigger className="w-full" id={`${fieldPrefix}-job-series`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_JOB_SERIES}>不限序列</SelectItem>
                      <SelectItem value="直属">直属</SelectItem>
                      <SelectItem value="派驻">派驻</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${fieldPrefix}-service-unit`}>服务单位（非必填）</FieldLabel>
                <FieldContent>
                  <Input
                    disabled={disabled}
                    id={`${fieldPrefix}-service-unit`}
                    maxLength={120}
                    onChange={(event) =>
                      updateAssignment(assignment.memberId, { serviceUnit: event.target.value })
                    }
                    placeholder="留空表示不限服务单位"
                    value={assignment.serviceUnit}
                  />
                </FieldContent>
              </Field>
            </div>
          </div>
        );
      })}
    </div>
  );
}
