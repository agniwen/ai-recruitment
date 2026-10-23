"use client";

import { buildOfferConfirmationText } from "@arc/shared/offer-confirmation";
import type {
  OfferConfirmationDetails,
  OfferCreationContext,
} from "@arc/shared/offer-confirmation";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResumeDocumentPreviewButton } from "@/components/features/resume/resume-document-preview-button";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/client/clipboard";

type TextField = Exclude<keyof OfferConfirmationDetails, "probationSalary">;
interface TextFieldConfig {
  key: TextField;
  label: string;
  maxLength: number;
  example?: string;
}
const identityFields: TextFieldConfig[] = [
  { key: "candidateCode", label: "候选人编码（选填）", maxLength: 120 },
  { key: "candidateName", label: "简历名（候选人姓名）", maxLength: 200 },
  { key: "gender", label: "性别", maxLength: 30 },
];
const organizationFields: TextFieldConfig[] = [
  { key: "hiringUnitName", label: "入职编制组织", maxLength: 200 },
  { key: "serviceUnit", label: "入职服务单位", maxLength: 200 },
  { example: "直属", key: "personnelType", label: "人员性质", maxLength: 120 },
  { key: "departmentName", label: "入职部门", maxLength: 200 },
  { key: "directManager", label: "直属上级", maxLength: 200 },
  { key: "jobType", label: "岗位类型", maxLength: 120 },
  { example: "P3", key: "jobLevel", label: "建议职级", maxLength: 120 },
  { example: "个人", key: "managementSequence", label: "管理序列", maxLength: 120 },
  { example: "远程", key: "workMode", label: "办公方式", maxLength: 120 },
  { example: "中国", key: "workLocation", label: "办公地区", maxLength: 200 },
];
export function OfferConfirmationFields({
  candidateId,
  info,
  onChange,
  idPrefix,
  positionField,
  salaryFields,
  disabled = false,
}: {
  candidateId: string;
  info: OfferConfirmationDetails;
  onChange: (value: OfferConfirmationDetails) => void;
  idPrefix: string;
  positionField?: ReactNode;
  salaryFields?: ReactNode;
  disabled?: boolean;
}) {
  function textField(field: TextFieldConfig) {
    const hintId = `${idPrefix}-${field.key}-hint`;
    const hint = field.example ? `例如：${field.example}` : "待补充";
    const showHint = Boolean(field.example) || !info[field.key]?.trim();
    return (
      <div
        className="grid min-w-0 gap-1.5 [&>[data-slot=native-select-wrapper]]:w-full"
        key={field.key}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
          {showHint ? (
            <span className="text-muted-foreground text-xs" id={hintId}>
              {hint}
            </span>
          ) : null}
        </div>
        {field.key === "gender" ? (
          <NativeSelect
            aria-describedby={showHint ? hintId : undefined}
            id={`${idPrefix}-gender`}
            onChange={(event) => onChange({ ...info, gender: event.target.value || null })}
            value={info.gender ?? ""}
          >
            <NativeSelectOption aria-label="未选择性别" value="" />
            {info.gender && !["男", "女"].includes(info.gender) ? (
              <NativeSelectOption disabled value={info.gender}>
                {info.gender}（原记录）
              </NativeSelectOption>
            ) : null}
            <NativeSelectOption value="男">男</NativeSelectOption>
            <NativeSelectOption value="女">女</NativeSelectOption>
          </NativeSelect>
        ) : (
          <Input
            aria-describedby={showHint ? hintId : undefined}
            id={`${idPrefix}-${field.key}`}
            maxLength={field.maxLength}
            onChange={(event) => onChange({ ...info, [field.key]: event.target.value || null })}
            value={info[field.key] ?? ""}
          />
        )}
      </div>
    );
  }
  return (
    <fieldset className="min-w-0 space-y-5" disabled={disabled}>
      <legend className="sr-only">Offer 确认信息</legend>
      <p className="text-muted-foreground text-xs leading-5">
        已带入系统中可用的信息。补填或修改仅保存到本次
        Offer，不会改动候选人或岗位资料；示例仅供参考，不会自动保存。
      </p>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">候选人信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-systemRecordCode`}>系统记录编码</Label>
            <Input
              className="bg-muted/30 font-mono text-xs"
              id={`${idPrefix}-systemRecordCode`}
              readOnly
              title={candidateId}
              value={candidateId}
            />
          </div>
          {identityFields.map(textField)}
        </div>
        <p className="text-muted-foreground text-xs">候选人编码可留空，填写时使用实际业务编码。</p>
      </section>
      <section className="space-y-3">
        <h3 className="font-medium text-sm">1️⃣编制信息</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {organizationFields.map((field) => (
            <Fragment key={field.key}>
              {textField(field)}
              {field.key === "jobType" ? positionField : null}
            </Fragment>
          ))}
        </div>
      </section>
      {salaryFields ? (
        <section className="space-y-3">
          <h3 className="font-medium text-sm">2️⃣薪资信息</h3>
          {salaryFields}
        </section>
      ) : null}
    </fieldset>
  );
}

export function OfferConfirmationText(props: Parameters<typeof buildOfferConfirmationText>[0]) {
  const text = buildOfferConfirmationText(props);
  const copyingRef = useRef(false);
  const [copying, setCopying] = useState(false);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const manualTextareaRef = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    if (copyingRef.current) {
      return;
    }
    copyingRef.current = true;
    setCopying(true);
    try {
      const result = await copyTextToClipboard(text, setManualCopyText);
      if (result === "copied") {
        toast.success("Offer 信息已复制");
      } else if (result === "manual") {
        toast.info("请在弹窗中全选并复制 Offer 信息");
      } else {
        toast.error("复制失败，请手动选择并复制 Offer 信息");
      }
    } catch {
      toast.error("复制失败，请手动选择并复制 Offer 信息");
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex justify-end">
        <Button disabled={copying} onClick={copy} size="sm" type="button" variant="outline">
          {copying ? "复制中…" : "复制 Offer 信息"}
        </Button>
      </div>
      <pre
        aria-label="Offer 确认内容"
        className="min-w-0 whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 font-sans text-sm leading-6"
      >
        {text}
      </pre>
      {manualCopyText === null ? null : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setManualCopyText(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>手动复制 Offer 信息</DialogTitle>
              <DialogDescription>请选择下方全文后复制，换行会完整保留。</DialogDescription>
            </DialogHeader>
            <Textarea
              aria-label="完整 Offer 信息"
              className="max-h-[50vh] resize-y font-mono text-xs"
              readOnly
              ref={manualTextareaRef}
              rows={16}
              value={manualCopyText}
            />
            <DialogFooter>
              <Button
                onClick={() => {
                  manualTextareaRef.current?.focus();
                  manualTextareaRef.current?.select();
                }}
                type="button"
                variant="outline"
              >
                全选内容
              </Button>
              <Button onClick={() => setManualCopyText(null)} type="button" variant="outline">
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function OfferCreationReview({
  candidateId,
  info,
  position,
  baseSalary,
  currency,
  resume,
  resumeUrl,
  expiresAt,
  disabled,
}: {
  candidateId: string;
  info: OfferConfirmationDetails;
  position: string;
  baseSalary: number;
  currency: string;
  resume?: OfferCreationContext["resume"];
  resumeUrl: string;
  expiresAt: string;
  disabled: boolean;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <section className="space-y-2">
        <h3 className="font-medium text-sm">完整确认内容</h3>
        <OfferConfirmationText
          candidateRecordId={candidateId}
          info={info}
          position={position}
          baseSalary={baseSalary}
          currency={currency}
          sscConfirmationStatus="pending"
        />
      </section>
      <section className="space-y-2">
        <h3 className="font-medium text-sm">原始简历</h3>
        {resume?.available ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all text-sm">{resume.filename}</span>
            <ResumeDocumentPreviewButton
              filename={resume.filename}
              mediaType={resume.mediaType}
              label="预览原始简历"
              disabled={disabled}
              url={resumeUrl}
            />
            <a
              className="text-primary text-sm underline underline-offset-4"
              href={resumeUrl}
              download={resume.filename ?? undefined}
            >
              下载
            </a>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">暂无原始简历附件。</p>
        )}
      </section>
      {expiresAt ? (
        <p className="text-muted-foreground text-sm">Offer 有效期至：{expiresAt}</p>
      ) : null}
    </div>
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
          candidateRecordId={draft.interviewRecordId}
          completionInfo={draft.completionInfo}
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
