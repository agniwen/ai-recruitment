"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ExternalInterviewerInput } from "@arc/db-schema/studio-interviews";
import type {
  HumanInterviewMeetingRecord,
  HumanInterviewRoundRecord,
} from "@arc/shared/studio-pipeline-stages";
import { patchHumanInterviewRound } from "@/lib/client/api";
import { dateTimeLocalInputToISOString } from "@/lib/client/datetime-local";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { DateTimePicker } from "@/components/date-time-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import {
  addOneHourToDateTimeLocalInputValue,
  addOneHourToIsoString,
  toDateTimeLocalInputValue,
} from "./human-interview-stage-utils";
import { HumanInterviewTimeZonePreview } from "./human-interview-time-zone-preview";
import { useExternalInterviewers } from "./use-external-interviewers";
import { useWorkspaceInterviewerMembers } from "./use-workspace-interviewer-members";
import { useHumanInterviewScheduleConfirmation } from "./use-human-interview-schedule-confirmation";

const EMPTY_EXTERNAL_INTERVIEWERS: ExternalInterviewerInput[] = [];

export function EditHumanInterviewRoundDialog({
  round,
  meeting,
  onOpenChange,
  onSaved,
}: {
  round: HumanInterviewRoundRecord;
  meeting: HumanInterviewMeetingRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const members = useWorkspaceInterviewerMembers();
  const external = useExternalInterviewers(
    true,
    round.interviewRecordId,
    round.externalInterviewers ?? EMPTY_EXTERNAL_INTERVIEWERS,
  );
  const { confirmSchedule, conflictDialog } = useHumanInterviewScheduleConfirmation();
  const [label, setLabel] = useState(round.label);
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocalInputValue(round.scheduledAt));
  const [validUntil, setValidUntil] = useState(
    toDateTimeLocalInputValue(meeting?.validUntil ?? addOneHourToIsoString(round.scheduledAt)),
  );
  const [interviewerIds, setInterviewerIds] = useState(round.interviewers.map((item) => item.id));
  const options = [
    ...new Map(
      [...round.interviewers, ...(members.data ?? [])].map((item) => [
        item.id,
        { label: item.name, value: item.id },
      ]),
    ).values(),
  ];
  const mutation = useMutation({
    mutationFn: async () => {
      const scheduledAtIso = dateTimeLocalInputToISOString(scheduledAt);
      const validUntilIso = dateTimeLocalInputToISOString(validUntil);
      if (!label.trim()) {
        throw new Error("请输入面试名称");
      }
      if (!scheduledAtIso) {
        throw new Error("请填写面试时间");
      }
      if (validUntilIso && new Date(validUntilIso) <= new Date(scheduledAtIso)) {
        throw new Error("有效时间至必须晚于面试时间");
      }
      const externalInterviewers = external.input();
      if (!interviewerIds.length && !externalInterviewers.length) {
        throw new Error("至少添加 1 位面试官");
      }
      if (
        interviewerIds.length &&
        !(await confirmSchedule({
          excludeRoundIds: meeting?.rounds.map((item) => item.roundId) ?? [round.id],
          interviewerIds,
          scheduledAt: scheduledAtIso,
          validUntil: validUntilIso,
        }))
      ) {
        return null;
      }
      return patchHumanInterviewRound(slug, round.interviewRecordId, round.id, {
        externalInterviewers,
        interviewerIds,
        label: label.trim(),
        scheduledAt: scheduledAtIso,
        validUntil: validUntilIso,
      });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "保存面试失败"),
    onSuccess: (result) => {
      if (!result) {
        return;
      }
      toast.success("面试安排已更新");
      if (result.externalNotificationFailures?.length) {
        toast.warning(
          `面试已保存，但以下人员通知失败，请复制最新链接手动发送：${result.externalNotificationFailures.join("、")}`,
        );
      }
      if (meeting) {
        void queryClient.invalidateQueries({
          queryKey: ["human-interview-meeting-links", slug, meeting.id],
        });
      }
      onSaved();
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!mutation.isPending) {
          onOpenChange(open);
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>编辑面试</DialogTitle>
          <DialogDescription>
            修改本轮面试的名称、时间和面试官，保存后同步更新会议安排。
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <fieldset disabled={mutation.isPending}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-round-label">面试名称</FieldLabel>
                <Input
                  id="edit-round-label"
                  maxLength={50}
                  required
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="edit-round-time">面试时间</FieldLabel>
                  <DateTimePicker
                    id="edit-round-time"
                    disabled={mutation.isPending}
                    required
                    value={scheduledAt}
                    onValueChange={(value) => {
                      setScheduledAt(value);
                      if (!validUntil) {
                        setValidUntil(addOneHourToDateTimeLocalInputValue(value));
                      }
                    }}
                  />
                  <HumanInterviewTimeZonePreview label="面试时间换算" value={scheduledAt} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-round-valid-until">有效时间至</FieldLabel>
                  <DateTimePicker
                    id="edit-round-valid-until"
                    disabled={mutation.isPending}
                    value={validUntil}
                    onValueChange={setValidUntil}
                  />
                  <HumanInterviewTimeZonePreview label="有效时间换算" value={validUntil} />
                </Field>
              </div>
              <FieldDescription>
                按中国标准时间（UTC+8）设置，有效时间留空时默认为面试开始后一小时。
              </FieldDescription>
              <Field>
                <FieldLabel htmlFor="edit-round-interviewers">内部面试官</FieldLabel>
                <SearchableMultiSelect
                  id="edit-round-interviewers"
                  options={options}
                  value={interviewerIds}
                  onChange={setInterviewerIds}
                  placeholder="选择面试官（可多选）"
                  searchPlaceholder="搜索成员…"
                  selectedFormat={(count) => `已选 ${count} 位面试官`}
                  selectedPreviewLimit={2}
                  disabled={mutation.isPending || members.isPending}
                />
                {members.isError ? (
                  <FieldDescription role="alert">
                    加载面试官失败。
                    <Button type="button" variant="link" onClick={() => void members.refetch()}>
                      重试
                    </Button>
                  </FieldDescription>
                ) : null}
              </Field>
              {external.fields}
            </FieldGroup>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                !label.trim() ||
                !external.valid ||
                (!interviewerIds.length && !external.count)
              }
            >
              {mutation.isPending ? "保存中…" : "保存修改"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {conflictDialog}
    </Dialog>
  );
}
