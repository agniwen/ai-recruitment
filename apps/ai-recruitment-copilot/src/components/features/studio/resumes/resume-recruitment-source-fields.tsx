"use client";

import type { ResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import {
  resumeRecruitmentSourceMeta,
  resumeRecruitmentSources,
} from "@arc/shared/bulk-resume-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ResumeRecruitmentSourceFields({
  detail,
  disabled = false,
  idPrefix,
  onDetailChange,
  onSourceChange,
  source,
}: {
  detail: string;
  disabled?: boolean;
  idPrefix: string;
  onDetailChange: (value: string) => void;
  onSourceChange: (value: ResumeRecruitmentSource) => void;
  source: ResumeRecruitmentSource | "";
}) {
  const detailMeta = source ? resumeRecruitmentSourceMeta[source] : null;

  return (
    <div>
      <Label className="mb-2 block text-sm" htmlFor={`${idPrefix}-source`}>
        简历来源 <span className="text-destructive">*</span>
      </Label>
      <Select
        disabled={disabled}
        onValueChange={(value) => {
          onSourceChange(value as ResumeRecruitmentSource);
          onDetailChange("");
        }}
        value={source}
      >
        <SelectTrigger aria-label="选择简历来源" className="w-full" id={`${idPrefix}-source`}>
          <SelectValue placeholder="请选择简历来源" />
        </SelectTrigger>
        <SelectContent>
          {resumeRecruitmentSources.map((value) => (
            <SelectItem key={value} value={value}>
              {resumeRecruitmentSourceMeta[value].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {detailMeta?.detailLabel ? (
        <div className="mt-3">
          <Label className="mb-2 block text-sm" htmlFor={`${idPrefix}-source-detail`}>
            {detailMeta.detailLabel}
            <span className="text-destructive"> *</span>
          </Label>
          <Input
            disabled={disabled}
            id={`${idPrefix}-source-detail`}
            maxLength={500}
            onChange={(event) => onDetailChange(event.target.value)}
            placeholder={detailMeta.detailPlaceholder ?? undefined}
            value={detail}
          />
        </div>
      ) : null}
    </div>
  );
}
