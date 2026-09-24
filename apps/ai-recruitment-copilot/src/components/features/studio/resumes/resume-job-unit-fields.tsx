import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { HiringUnitRecord } from "@arc/shared/hiring-units";
import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import {
  emptyImportDestination,
  importJobNameOptions,
} from "../resume-pool/resume-pool-import-selection";

function buildSelectionOptions(
  jobs: JobDescriptionListRecord[],
  units: HiringUnitRecord[],
  hiringUnitId: string | null,
  jobName: string,
) {
  const jobOptions = importJobNameOptions(
    { jobDescriptions: jobs },
    hiringUnitId ? [emptyImportDestination(hiringUnitId)] : [],
  );
  const unitMap = new Map(
    units.map((unit) => [
      unit.id,
      {
        description: unit.resumeSourceName ? `中心：${unit.resumeSourceName}` : "未关联中心",
        label: unit.name,
        value: unit.id,
      },
    ]),
  );
  for (const job of jobs) {
    if (job.hiringUnitId && !unitMap.has(job.hiringUnitId)) {
      unitMap.set(job.hiringUnitId, {
        description: job.resumeSourceName ? `岗位中心：${job.resumeSourceName}` : "中心信息未提供",
        label: job.hiringUnitName ?? "未命名组织",
        value: job.hiringUnitId,
      });
    }
  }
  const unitOptions = [...unitMap.values()].filter((unit) =>
    jobs.some(
      (job) => job.hiringUnitId === unit.value && (!jobName || job.name.trim() === jobName),
    ),
  );
  const matches = jobs.filter(
    (job) => job.hiringUnitId === hiringUnitId && job.name.trim() === jobName,
  );
  return { jobOptions, matches, unitMap, unitOptions };
}

// oxlint-disable-next-line complexity -- single-select flow renders loading, historical values, and optional concrete destinations.
export function ResumeJobUnitFields({
  units,
  hiringUnitId,
  jobDescriptionId,
  onChange,
  disabled,
  hideAiInterviewDisabled,
  currentJobName,
  currentUnitName,
  error,
}: {
  units: HiringUnitRecord[];
  hiringUnitId: string | null;
  jobDescriptionId: string;
  onChange: (unitId: string | null, jobId: string) => void;
  disabled: boolean;
  hideAiInterviewDisabled: boolean;
  currentJobName: string | null;
  currentUnitName: string | null;
  error?: string;
}) {
  const slug = useWorkspaceSlug();
  const query = useQuery({
    queryFn: async () => {
      const payload = await rpcFetch<{ records: JobDescriptionListRecord[] }>(
        rpc.api.w[":slug"].studio["job-descriptions"].all.$get({ param: { slug }, query: {} }),
        "加载在招岗位失败",
      );
      return payload.records;
    },
    queryKey: ["job-descriptions", "all", slug],
    staleTime: 0,
  });
  const jobs = (query.data ?? []).filter(
    (job) => job.hiringUnitId && (!hideAiInterviewDisabled || !job.aiInterviewDisabled),
  );
  const selectedJob = jobs.find((job) => job.id === jobDescriptionId);
  const [chosenName, setChosenName] = useState<string | null>(null);
  const jobName =
    chosenName ?? selectedJob?.name.trim() ?? (jobDescriptionId ? (currentJobName ?? "") : "");
  const { jobOptions, unitMap, unitOptions, matches } = buildSelectionOptions(
    jobs,
    units,
    hiringUnitId,
    jobName,
  );
  const select = (name: string, unitId: string | null) => {
    setChosenName(name);
    const candidates = jobs.filter(
      (job) => job.name.trim() === name && job.hiringUnitId === unitId,
    );
    onChange(unitId, candidates.length === 1 ? candidates[0].id : "");
  };
  const unavailable = Boolean(jobDescriptionId && query.isSuccess && !selectedJob);
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="resume-edit-job-name">
          关联在招岗位
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        </FieldLabel>
        <SearchableSelect
          clearable
          disabled={disabled || query.isPending || query.isError}
          id="resume-edit-job-name"
          value={jobName || null}
          options={jobOptions}
          placeholder={unavailable ? (currentJobName ?? "原岗位当前不可选") : "请选择在招岗位"}
          searchPlaceholder="搜索岗位..."
          onChange={(name) => select(name ?? "", hiringUnitId)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="resume-edit-hiring-unit">
          用人组织
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        </FieldLabel>
        <SearchableSelect
          clearable
          disabled={disabled || query.isPending || query.isError}
          id="resume-edit-hiring-unit"
          value={hiringUnitId}
          options={unitOptions}
          placeholder={hiringUnitId ? (currentUnitName ?? "原组织当前不可选") : "请选择用人组织"}
          searchPlaceholder="搜索用人组织或中心..."
          onChange={(id) => select(jobName, id)}
        />
        {hiringUnitId && unitMap.get(hiringUnitId) ? (
          <FieldDescription>{unitMap.get(hiringUnitId)?.description}</FieldDescription>
        ) : null}
      </Field>
      {matches.length > 1 ? (
        <Field>
          <FieldLabel htmlFor="resume-edit-job-destination">
            具体岗位去向
            <span aria-hidden className="ml-1 text-destructive">
              *
            </span>
          </FieldLabel>
          <SearchableSelect
            disabled={disabled}
            id="resume-edit-job-destination"
            value={jobDescriptionId}
            options={matches.map((job) => ({
              description: [job.resumeSourceName, job.code || job.id].filter(Boolean).join(" / "),
              label: [job.departmentName, job.serviceUnit].filter(Boolean).join(" / ") || job.name,
              value: job.id,
            }))}
            placeholder="请选择具体岗位去向"
            onChange={(id) => onChange(hiringUnitId, id ?? "")}
          />
        </Field>
      ) : null}
      <FieldDescription>
        可先选岗位或组织，选项会相互筛选。每份简历只关联一个组织下的一个具体岗位。
      </FieldDescription>
      {unavailable ? (
        <output className="text-muted-foreground text-sm">
          原岗位当前不在可选范围内，保留原关联；如需更换，请重新选择岗位和组织。
        </output>
      ) : null}
      {query.isError ? <p role="alert">加载在招岗位失败，请关闭弹窗后重试。</p> : null}
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </div>
  );
}
