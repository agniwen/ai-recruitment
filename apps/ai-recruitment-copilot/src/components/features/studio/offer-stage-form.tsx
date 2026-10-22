"use client";

/* oxlint-disable no-use-before-define -- helper components defined below export component for top-down readability */
// Offer 阶段的详情面板内容：
//   - 顶部：候选人期望（薪资 / 现 base / 期望入职日）—— 可编辑，partial merge
//   - 下方：Offer 草稿版本时间线（version desc）
//   - 新建 Offer / 编辑 draft / 发送 / 记录响应 / 撤回
//   - 候选人接受 Offer 时弹二次确认，请上层走「标记结案 hired」流程
//
// Offer-stage panel: candidate expectations inline form + offer draft
// timeline. Draft → sent → respond / cancel flows; on "accepted" we prompt
// the caller to launch the close flow.

import type { Dispatch, SetStateAction } from "react";
import type { OfferDraftInput } from "@arc/db-schema/studio-interviews";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import type { OfferConfirmationDetails } from "@arc/db-schema/offer-confirmation";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { formatDate as formatChinaDate } from "@arc/shared/utils/time";
import { DatePicker } from "@/components/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OfferCurrencySelect, offerCurrencySymbol, parseOfferCurrency } from "./offer-currency";
import { OfferConfirmationFields } from "./offer-creation-confirmation";

const probationPeriods = Array.from({ length: 12 }, (_value, index) => `${index + 1}个月`);

// Toast 文案 helper：避免内联三元嵌套（mode + sendImmediately 两维组合）。
// Save-success toast helper; flattens the nested ternary of mode × sendImmediately.
export function saveSuccessMessage(mode: "create" | "edit", sendImmediately: boolean): string {
  if (mode === "edit") {
    return "已更新草稿";
  }
  return sendImmediately ? "Offer 已发送" : "已保存草稿";
}

// 响应选项的中文标签 helper。
// Localized labels for the offer-response radio options.
export function offerResponseLabel(value: "accepted" | "declined" | "counter"): string {
  if (value === "accepted") {
    return "接受";
  }
  return value === "declined" ? "拒绝" : "议价";
}

export function formatDate(iso: string): string {
  return formatChinaDate(iso, "YYYY-MM-DD");
}

export function formatIsoDateOnly(iso: string): string {
  const dateOnly = iso.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dateOnly ?? formatDate(iso);
}

export interface OfferFormState {
  position: string;
  baseSalary: string;
  currency: string;
  bonus: string;
  equity: string;
  joiningDate: string;
  expiresAt: string;
  notes: string;
  confirmationInfo: OfferConfirmationDetails | null;
}

export function createBlankOfferFormState(): OfferFormState {
  return {
    baseSalary: "",
    bonus: "",
    confirmationInfo: null,
    currency: "CNY",
    equity: "",
    expiresAt: "",
    joiningDate: "",
    notes: "",
    position: "",
  };
}

export function offerFormStateFromDraft(draft: OfferDraftRecord): OfferFormState {
  return {
    baseSalary: String(draft.baseSalary),
    bonus: draft.bonus === null ? "" : String(draft.bonus),
    confirmationInfo: draft.confirmationInfo ?? null,
    currency: draft.currency || "CNY",
    equity: draft.equity ?? "",
    expiresAt: draft.expiresAt ? formatIsoDateOnly(draft.expiresAt) : "",
    joiningDate: draft.joiningDate ?? "",
    notes: draft.notes ?? "",
    position: draft.position,
  };
}

export function createOfferFormFieldSetter(setForm: Dispatch<SetStateAction<OfferFormState>>) {
  return <K extends keyof OfferFormState>(field: K, value: OfferFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
}

export function getOfferRequiredFieldErrors(form: OfferFormState) {
  const errors: { position?: string; baseSalary?: string } = {};
  if (!form.position.trim()) {
    errors.position = "请填写职位";
  }
  if (!form.baseSalary.trim()) {
    errors.baseSalary = "请填写转正薪资（月薪）";
  } else if (!Number.isInteger(Number(form.baseSalary)) || Number(form.baseSalary) <= 0) {
    errors.baseSalary = "转正薪资（月薪）需为正整数";
  }
  return errors;
}

export function buildOfferDraftPayload(form: OfferFormState): OfferDraftInput {
  const parsedBase = Number(form.baseSalary);
  const errors = Object.values(getOfferRequiredFieldErrors(form));
  if (errors.length > 0) {
    throw new Error(errors.join("；"));
  }
  const confirmation = form.confirmationInfo
    ? offerConfirmationDetailsSchema.safeParse(form.confirmationInfo)
    : null;
  if (confirmation && !confirmation.success) {
    throw new Error(confirmation.error.issues[0]?.message ?? "请检查 Offer 确认信息");
  }
  return {
    baseSalary: parsedBase,
    confirmationInfo: confirmation?.success ? confirmation.data : null,
    currency: parseOfferCurrency(form.currency),
    expiresAt: form.expiresAt || null,
    position: form.position.trim(),
  };
}

export function OfferDraftFormFields({
  candidateId,
  form,
  idPrefix,
  onFieldChange,
  showValidationErrors = false,
  disabled = false,
}: {
  candidateId: string;
  form: OfferFormState;
  idPrefix: string;
  onFieldChange: <K extends keyof OfferFormState>(field: K, value: OfferFormState[K]) => void;
  disabled?: boolean;
  showValidationErrors?: boolean;
}) {
  const errors = getOfferRequiredFieldErrors(form);
  const symbol = offerCurrencySymbol(form.currency);
  const info = form.confirmationInfo ?? offerConfirmationDetailsSchema.parse({});
  function setProbationField<K extends "probationPeriod" | "probationSalary">(
    field: K,
    value: OfferConfirmationDetails[K],
  ) {
    onFieldChange("confirmationInfo", { ...info, [field]: value });
  }
  return (
    <fieldset className="min-w-0 space-y-5" disabled={disabled}>
      <legend className="sr-only">填写 Offer 信息</legend>
      <OfferConfirmationFields
        candidateId={candidateId}
        info={info}
        idPrefix={`${idPrefix}-confirm`}
        disabled={disabled}
        onChange={(value) => onFieldChange("confirmationInfo", value)}
        positionField={
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Label htmlFor={`${idPrefix}-position`}>职位（必填）</Label>
              <span className="text-muted-foreground text-xs" id={`${idPrefix}-position-hint`}>
                例如：高级前端工程师（L4）
              </span>
            </div>
            <Input
              aria-describedby={`${idPrefix}-position-hint`}
              aria-invalid={showValidationErrors && Boolean(errors.position)}
              aria-required
              id={`${idPrefix}-position`}
              maxLength={200}
              onChange={(event) => onFieldChange("position", event.target.value)}
              value={form.position}
            />
            {showValidationErrors && errors.position ? (
              <p className="text-destructive text-xs">{errors.position}</p>
            ) : null}
          </div>
        }
        salaryFields={
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-start-1">
              <Label htmlFor={`${idPrefix}-currency`}>薪资货币</Label>
              <OfferCurrencySelect
                id={`${idPrefix}-currency`}
                value={form.currency}
                onChange={(value) => onFieldChange("currency", value)}
              />
            </div>
            <div className="grid gap-1.5 sm:col-start-1">
              <Label htmlFor={`${idPrefix}-base`}>转正薪资（月薪，{symbol}，必填）</Label>
              <Input
                aria-invalid={showValidationErrors && Boolean(errors.baseSalary)}
                aria-required
                id={`${idPrefix}-base`}
                inputMode="numeric"
                min={0}
                step={1}
                onChange={(event) => onFieldChange("baseSalary", event.target.value)}
                type="number"
                value={form.baseSalary}
              />
              {showValidationErrors && errors.baseSalary ? (
                <p className="text-destructive text-xs">{errors.baseSalary}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Label htmlFor={`${idPrefix}-confirm-probationSalary`}>
                  试用薪资（月薪，{symbol}）
                </Label>
                {info.probationSalary === null ? (
                  <span
                    className="text-muted-foreground text-xs"
                    id={`${idPrefix}-confirm-probationSalary-hint`}
                  >
                    待补充
                  </span>
                ) : null}
              </div>
              <Input
                aria-describedby={
                  info.probationSalary === null
                    ? `${idPrefix}-confirm-probationSalary-hint`
                    : undefined
                }
                id={`${idPrefix}-confirm-probationSalary`}
                inputMode="numeric"
                min={0}
                step={1}
                onChange={(event) =>
                  setProbationField(
                    "probationSalary",
                    event.target.value === "" ? null : Number(event.target.value),
                  )
                }
                type="number"
                value={info.probationSalary ?? ""}
              />
            </div>
            <div className="grid gap-1.5 sm:col-start-1 [&>[data-slot=native-select-wrapper]]:w-full">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Label htmlFor={`${idPrefix}-confirm-probationPeriod`}>试用期期限（月）</Label>
                <span
                  className="text-muted-foreground text-xs"
                  id={`${idPrefix}-confirm-probationPeriod-hint`}
                >
                  例如：2
                </span>
              </div>
              <NativeSelect
                aria-describedby={`${idPrefix}-confirm-probationPeriod-hint`}
                id={`${idPrefix}-confirm-probationPeriod`}
                onChange={(event) =>
                  setProbationField("probationPeriod", event.target.value || null)
                }
                value={info.probationPeriod ?? ""}
              >
                <NativeSelectOption aria-label="未选择试用期" value="" />
                {info.probationPeriod && !probationPeriods.includes(info.probationPeriod) ? (
                  <NativeSelectOption disabled value={info.probationPeriod}>
                    {info.probationPeriod}（原记录）
                  </NativeSelectOption>
                ) : null}
                {probationPeriods.map((period, index) => (
                  <NativeSelectOption key={period} value={period}>
                    {index + 1}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        }
      />
      <section className="space-y-3 border-t pt-4">
        <h3 className="font-medium text-sm">系统设置</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-expires`}>Offer 有效期至（可选）</Label>
            <DatePicker
              id={`${idPrefix}-expires`}
              onValueChange={(value) => onFieldChange("expiresAt", value)}
              value={form.expiresAt}
            />
          </div>
        </div>
      </section>
    </fieldset>
  );
}

// ── 新建 / 编辑 Offer dialog ──
// Create-or-edit dialog.
