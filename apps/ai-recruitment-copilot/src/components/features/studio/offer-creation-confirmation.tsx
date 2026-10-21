"use client";

import { buildOfferConfirmationText } from "@arc/shared/offer-confirmation";
import type {
  OfferConfirmationDetails,
  OfferCreationContext,
} from "@arc/shared/offer-confirmation";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TextField = Exclude<keyof OfferConfirmationDetails, "probationSalary">;
const identityFields: { key: TextField; label: string; maxLength: number }[] = [
  { key: "candidateCode", label: "候选人编码", maxLength: 120 },
  { key: "candidateName", label: "简历名（候选人姓名）", maxLength: 200 },
  { key: "gender", label: "性别", maxLength: 30 },
];
const organizationFields: { key: TextField; label: string; maxLength: number }[] = [
  { key: "hiringUnitName", label: "编制组织", maxLength: 200 },
  { key: "serviceUnit", label: "服务单位", maxLength: 200 },
  { key: "personnelType", label: "人员性质", maxLength: 120 },
  { key: "departmentName", label: "部门", maxLength: 200 },
  { key: "directManager", label: "直属上级", maxLength: 200 },
  { key: "jobType", label: "岗位类型", maxLength: 120 },
  { key: "jobLevel", label: "建议职级", maxLength: 120 },
  { key: "managementSequence", label: "管理序列", maxLength: 120 },
  { key: "workMode", label: "办公方式", maxLength: 120 },
  { key: "workLocation", label: "办公地区", maxLength: 200 },
];
const selectClassName =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";

export function OfferConfirmationFields({
  info,
  onChange,
  idPrefix,
  context,
  disabled = false,
}: {
  info: OfferConfirmationDetails;
  onChange: (value: OfferConfirmationDetails) => void;
  idPrefix: string;
  context?: OfferCreationContext | null;
  disabled?: boolean;
}) {
  const selectedRound = context?.interviewRounds.find(
    (round) => round.id === info.interviewRoundId,
  );
  function textField(field: { key: TextField; label: string; maxLength: number }) {
    return (
      <div className="grid min-w-0 gap-1.5" key={field.key}>
        <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
        <Input
          id={`${idPrefix}-${field.key}`}
          maxLength={field.maxLength}
          onChange={(event) => onChange({ ...info, [field.key]: event.target.value || null })}
          placeholder="待补充"
          value={info[field.key] ?? ""}
        />
      </div>
    );
  }
  return (
    <fieldset className="min-w-0 space-y-5" disabled={disabled}>
      <legend className="sr-only">Offer 确认信息</legend>
      <p className="text-muted-foreground text-xs leading-5">
        已带入系统中可用的信息。补填或修改仅保存到本次
        Offer，不会改动候选人或岗位资料；未填写的字段显示为「待补充」。
      </p>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">候选人信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">{identityFields.map(textField)}</div>
        <p className="text-muted-foreground text-xs">候选人编码请按实际业务编码填写。</p>
      </section>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">编制与岗位</h3>
        <div className="grid gap-3 sm:grid-cols-2">{organizationFields.map(textField)}</div>
      </section>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">试用期薪资</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {textField({ key: "probationPeriod", label: "试用期", maxLength: 120 })}
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-probationSalary`}>试用薪资（与转正薪资同币种）</Label>
            <Input
              id={`${idPrefix}-probationSalary`}
              inputMode="numeric"
              min={0}
              step={1}
              type="number"
              placeholder="待补充"
              value={info.probationSalary ?? ""}
              onChange={(event) =>
                onChange({
                  ...info,
                  probationSalary: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">面试评价</h3>
        {context && context.interviewRounds.length > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-interviewRoundId`}>引用真人面试轮次</Label>
            <select
              className={selectClassName}
              id={`${idPrefix}-interviewRoundId`}
              value={info.interviewRoundId ?? ""}
              onChange={(event) => {
                const round = context.interviewRounds.find(
                  (item) => item.id === event.target.value,
                );
                onChange({
                  ...info,
                  interviewFeedback: round?.feedback ?? null,
                  interviewRoundId: round?.id ?? null,
                  mainInterviewerName: null,
                });
              }}
            >
              <option value="">不指定轮次，手动填写</option>
              {context.interviewRounds.map((round) => (
                <option key={round.id} value={round.id}>
                  {round.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {selectedRound && selectedRound.interviewers.length > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-mainInterviewerName`}>主要面试官</Label>
            <select
              className={selectClassName}
              id={`${idPrefix}-mainInterviewerName`}
              value={info.mainInterviewerName ?? ""}
              onChange={(event) =>
                onChange({ ...info, mainInterviewerName: event.target.value || null })
              }
            >
              <option value="">请选择主要面试官</option>
              {selectedRound.interviewers.map((interviewer) => (
                <option key={interviewer.id} value={interviewer.name}>
                  {interviewer.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          textField({ key: "mainInterviewerName", label: "主要面试官", maxLength: 200 })
        )}
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-interviewFeedback`}>面试评价内容</Label>
          <Textarea
            id={`${idPrefix}-interviewFeedback`}
            maxLength={5000}
            rows={4}
            placeholder="待补充，可引用面试轮次后修改"
            value={info.interviewFeedback ?? ""}
            onChange={(event) =>
              onChange({ ...info, interviewFeedback: event.target.value || null })
            }
          />
        </div>
      </section>
    </fieldset>
  );
}

export function OfferConfirmationText(props: Parameters<typeof buildOfferConfirmationText>[0]) {
  return (
    <pre
      aria-label="Offer 确认内容"
      className="min-w-0 whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 font-sans text-sm leading-6"
    >
      {buildOfferConfirmationText(props)}
    </pre>
  );
}

export function OfferInformationDialog({
  draft,
  open,
  onOpenChange,
}: {
  draft: OfferDraftRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Offer 信息 · v{draft.version}</DialogTitle>
          <DialogDescription>本次 Offer 保存的确认内容。</DialogDescription>
        </DialogHeader>
        <OfferConfirmationText
          info={draft.confirmationInfo}
          position={draft.position}
          baseSalary={draft.baseSalary}
          currency={draft.currency}
          sscConfirmationStatus={draft.sscConfirmationStatus}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
