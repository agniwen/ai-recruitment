"use client";

import { IconDatabase, IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ResumePoolScope } from "@arc/db-schema/schema";
import { resumePoolScopeMeta } from "@arc/shared/resume-pool";
import { describeResumeRecruitmentSource } from "@arc/shared/bulk-resume-upload";
import type {
  ResumePoolImportDuplicateResult,
  ResumePoolListRecord,
} from "@arc/shared/resume-pool";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getMemberInitials } from "@/components/data-grid/cells/member-cell";
import { TimeDisplay } from "@/components/features/display/time-display";
import { ResumeDedupMatchList } from "@/components/features/resume/resume-dedup-overlay";
import { formatResumeRecordDisplayId } from "@/components/features/resume/resume-record-display-id";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { importResumePoolItem, isApiError } from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { rpc } from "@/lib/client/rpc";

import {
  buildJdOptions,
  getCandidateTitle,
  normalizeScope,
  toResumeDedupMatches,
  useJobDescriptions,
} from "./resume-pool-page-model";
import { buildResumePoolRecommendationTemplate } from "./resume-pool-recommendation-template";

const StudioPersonDetailDialog = lazy(async () => {
  const detailDialog = await import("@/components/features/studio/studio-person-detail-dialog");
  return { default: detailDialog.StudioPersonDetailDialog };
});

const RESUME_POOL_IMPORT_RECOMMENDATION_MAX_LENGTH = 2000;

function ImportedResumeRecords({
  item,
  onOpenRecord,
}: {
  item: ResumePoolListRecord | null;
  onOpenRecord: (recordId: string) => void;
}) {
  const importedRecords = item?.importedRecords ?? [];
  if (!item?.importedResumeRecordId || importedRecords.length === 0) {
    return null;
  }
  const candidateTitle = getCandidateTitle(item);
  return (
    <Field>
      <FieldLabel>已入库记录</FieldLabel>
      <FieldContent>
        <div className="flex flex-col gap-2">
          {importedRecords.map((record) => {
            const creatorName = record.creatorName?.trim() || "已删除用户";
            return (
              <Button
                aria-label={`查看已入库记录 ${record.resumeRecordId}`}
                className="h-auto w-full justify-between py-3"
                key={record.resumeRecordId}
                onClick={() => onOpenRecord(record.resumeRecordId)}
                type="button"
                variant="outline"
              >
                <span className="min-w-0 text-left">
                  <span className="block truncate">{candidateTitle}</span>
                  <span className="mt-0.5 block text-muted-foreground text-xs font-normal">
                    {formatResumeRecordDisplayId(record.resumeRecordId)}
                    {" · "}
                    <TimeDisplay as="span" value={record.importedAt} />
                  </span>
                  <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs font-normal">
                    <Avatar size="sm">
                      {record.creatorImage ? (
                        <AvatarImage alt={creatorName} src={record.creatorImage} />
                      ) : null}
                      <AvatarFallback>{getMemberInitials(record.creatorName)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">创建人 {creatorName}</span>
                  </span>
                </span>
                <IconExternalLink data-icon="inline-end" />
              </Button>
            );
          })}
        </div>
      </FieldContent>
    </Field>
  );
}

function ImportedResumeDetailDialog({
  onClose,
  recordId,
}: {
  onClose: () => void;
  recordId: string | null;
}) {
  if (!recordId) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <StudioPersonDetailDialog
        mode="resume"
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        open={true}
        recordId={recordId}
      />
    </Suspense>
  );
}

function describePoolItemRecruitmentSource(item: ResumePoolListRecord | null): string {
  const recruitmentSource = describeResumeRecruitmentSource(
    item?.recruitmentSource,
    item?.recruitmentSourceDetail,
  );
  if (recruitmentSource) {
    return recruitmentSource;
  }
  if (item?.sourceChannel === "referral") {
    return "内推";
  }
  if (item?.sourceChannel === "mail_ingest") {
    return "邮件入库";
  }
  return "";
}

export function SelectResumePoolScopeDialog({
  defaultScope,
  onOpenChange,
  onSelected,
  open,
}: {
  defaultScope: ResumePoolScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelected: (scope: ResumePoolScope) => void;
}) {
  const [scope, setScope] = useState<ResumePoolScope>(defaultScope);

  useEffect(() => {
    if (open) {
      setScope(defaultScope);
    }
  }, [defaultScope, open]);

  return (
    <Modal
      footer={
        <>
          <Button size="lg" onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button
            size="lg"
            onClick={() => {
              onOpenChange(false);
              onSelected(scope);
            }}
          >
            下一步
          </Button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      size="sm"
      title="选择归属范围"
    >
      <RadioGroup
        className="grid grid-cols-2 gap-2"
        onValueChange={(value) => setScope(normalizeScope(value))}
        value={scope}
      >
        {(["private", "public"] as const).map((item) => (
          <FieldLabel className="w-full rounded-md border p-3" key={item}>
            <RadioGroupItem value={item} />
            <span>{resumePoolScopeMeta[item].label}</span>
          </FieldLabel>
        ))}
      </RadioGroup>
    </Modal>
  );
}

// oxlint-disable-next-line complexity -- Import coordinates source metadata, destination selection, deduplication, and confirmation states.
export function ImportResumePoolDialog({
  item,
  onImported,
  onOpenChange,
}: {
  item: ResumePoolListRecord | null;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const slug = useWorkspaceSlug();
  const { data: jobDescriptions = [] } = useJobDescriptions(slug);
  const { data: hiringUnits = [] } = useQuery({
    enabled: item !== null,
    queryFn: async () => {
      const response = await rpc.api.w[":slug"].studio["hiring-units"].selectable.$get({
        param: { slug },
      });
      const payload = (await response.json().catch(() => null)) as
        | { records: { id: string; name: string }[] }
        | { error?: string; message?: string }
        | null;
      if (!response.ok || !payload || !("records" in payload)) {
        throw new Error("加载可选用人组织失败");
      }
      return payload.records;
    },
    queryKey: ["hiring-units", slug, "selectable"],
    refetchOnWindowFocus: false,
  });
  const hiringUnitOptions = useMemo(
    () => hiringUnits.map((unit) => ({ label: unit.name, value: unit.id })),
    [hiringUnits],
  );
  const [mode, setMode] = useState<"none" | "bind">("none");
  const [hiringUnitId, setHiringUnitId] = useState("");
  const [jobDescriptionId, setJobDescriptionId] = useState("");
  const [recommendationText, setRecommendationText] = useState("");
  const [duplicates, setDuplicates] = useState<ResumePoolImportDuplicateResult | null>(null);
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);
  const isReimport = Boolean(item?.importedResumeRecordId);

  useEffect(() => {
    if (!item) {
      setMode("none");
      setHiringUnitId("");
      setJobDescriptionId("");
      setRecommendationText("");
      setDuplicates(null);
      setDetailRecordId(null);
      return;
    }
    const canUseSourceJd =
      item.scope === "private" &&
      item.jobDescriptionId &&
      jobDescriptions.some((jd) => jd.id === item.jobDescriptionId);
    setMode(canUseSourceJd ? "bind" : "none");
    setJobDescriptionId(canUseSourceJd ? (item.jobDescriptionId ?? "") : "");
    setDuplicates(null);
  }, [item, jobDescriptions]);

  const mutation = useMutation({
    mutationFn: async (dedupPolicy: "check" | "force") => {
      if (!item) {
        throw new Error("请选择要入库的简历");
      }
      if (!hiringUnitId) {
        throw new Error("请选择入库组织");
      }
      return await importResumePoolItem(slug, item.id, {
        dedupPolicy,
        hiringUnitId,
        jobDescriptionId: mode === "bind" ? jobDescriptionId : null,
        jobDescriptionMode: mode,
        recommendationText,
        reimport: isReimport,
      });
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        const payload = error.payload as ResumePoolImportDuplicateResult | null;
        if (payload?.status === "duplicate_found") {
          setDuplicates(payload);
          return;
        }
      }
      toast.error(error instanceof Error ? error.message : "入库失败");
    },
    onSuccess: (result) => {
      if (result.status === "duplicate_found") {
        setDuplicates(result);
        return;
      }
      toast.success(isReimport ? "已再次入库到招聘台" : "已入库到招聘台");
      onImported();
      onOpenChange(false);
    },
  });

  const bindInvalid = mode === "bind" && !jobDescriptionId;
  const hiringUnitInvalid = !hiringUnitId;
  const { isPending } = mutation;
  const selectedJobDescription = jobDescriptions.find((jd) => jd.id === jobDescriptionId);
  const selectedHiringUnit = hiringUnits.find((unit) => unit.id === hiringUnitId);
  const recruitmentSource = describePoolItemRecruitmentSource(item);
  let dialogDescription: string | undefined;
  if (item) {
    dialogDescription = isReimport ? "已在招聘台，是否再次入库。" : getCandidateTitle(item);
  }

  return (
    <>
      <Modal
        dismissible={!isPending}
        footer={
          <>
            <Button disabled={isPending} onClick={() => onOpenChange(false)} variant="outline">
              取消
            </Button>
            <Button
              disabled={isPending || bindInvalid || hiringUnitInvalid}
              onClick={() => mutation.mutate(isReimport ? "force" : "check")}
            >
              {isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDatabase className="size-4" />
              )}
              {isReimport ? "确认再次入库" : "确认入库"}
            </Button>
          </>
        }
        onOpenChange={(next) => {
          if (!next && isPending) {
            return;
          }
          onOpenChange(next);
        }}
        open={item !== null}
        size="md"
        title={isReimport ? "再次入库到招聘台" : "入库到招聘台"}
        description={dialogDescription}
      >
        <div className="flex flex-col gap-5">
          <ImportedResumeRecords item={item} onOpenRecord={setDetailRecordId} />
          <Field>
            <FieldLabel>关联岗位</FieldLabel>
            <FieldContent>
              <RadioGroup
                className="grid grid-cols-2 gap-2"
                disabled={isPending}
                onValueChange={(value) => setMode(value === "bind" ? "bind" : "none")}
                value={mode}
              >
                <FieldLabel className="w-full rounded-md border p-3">
                  <RadioGroupItem value="none" />
                  <span>不绑定岗位</span>
                </FieldLabel>
                <FieldLabel className="w-full rounded-md border p-3">
                  <RadioGroupItem value="bind" />
                  <span>绑定岗位</span>
                </FieldLabel>
              </RadioGroup>
            </FieldContent>
          </Field>
          {mode === "bind" ? (
            <Field data-invalid={bindInvalid ? true : undefined}>
              <FieldLabel htmlFor="resume-pool-import-jd">在招岗位</FieldLabel>
              <FieldContent>
                <SearchableSelect
                  disabled={isPending}
                  id="resume-pool-import-jd"
                  invalid={bindInvalid}
                  onChange={(next) => setJobDescriptionId(next ?? "")}
                  options={buildJdOptions(jobDescriptions)}
                  placeholder="请选择在招岗位"
                  searchPlaceholder="搜索岗位..."
                  value={jobDescriptionId || null}
                />
              </FieldContent>
            </Field>
          ) : null}
          <Field data-invalid={hiringUnitInvalid ? true : undefined}>
            <FieldLabel htmlFor="resume-pool-import-hiring-unit">入库组织</FieldLabel>
            <FieldContent>
              <SearchableSelect
                disabled={isPending}
                id="resume-pool-import-hiring-unit"
                invalid={hiringUnitInvalid}
                onChange={(next) => setHiringUnitId(next ?? "")}
                options={hiringUnitOptions}
                placeholder="请选择入库组织"
                searchPlaceholder="搜索用人组织..."
                value={hiringUnitId || null}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>简历来源</FieldLabel>
            <FieldContent>
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {recruitmentSource || "未填写（将原样同步到招聘台）"}
              </p>
              <p className="text-muted-foreground text-xs">
                入库时会把广场/简历池中的来源复制到招聘台候选人记录。
              </p>
            </FieldContent>
          </Field>
          <Field>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor="resume-pool-import-recommendation">推荐理由</FieldLabel>
              <Button
                className="h-auto px-0 py-0 text-xs"
                disabled={isPending}
                onClick={() =>
                  setRecommendationText(
                    buildResumePoolRecommendationTemplate({
                      candidateContact: item?.candidatePhone ?? item?.candidateEmail,
                      candidateName: item?.candidateName,
                      hiringUnitName: selectedHiringUnit?.name,
                      jobDescriptionName:
                        mode === "bind"
                          ? selectedJobDescription?.name
                          : (item?.jobDescriptionName ?? item?.targetRole),
                      jobSeries: selectedJobDescription?.jobSeries,
                      recruitmentSource,
                      referrerName:
                        item?.recruitmentSource === "referral"
                          ? item.recruitmentSourceDetail
                          : null,
                      resumeContact: selectedJobDescription?.resumeContact,
                      serviceUnit: selectedJobDescription?.serviceUnit,
                      workYears: item?.workYears,
                    }),
                  )
                }
                type="button"
                variant="link"
              >
                插入模版
              </Button>
            </div>
            <FieldContent>
              <Textarea
                disabled={isPending}
                id="resume-pool-import-recommendation"
                maxLength={RESUME_POOL_IMPORT_RECOMMENDATION_MAX_LENGTH}
                onChange={(event) => setRecommendationText(event.target.value)}
                placeholder="可点「插入模版」自动带出简历字段，再人工补全薪资、到岗等信息"
                rows={12}
                value={recommendationText}
              />
            </FieldContent>
          </Field>
        </div>
      </Modal>
      <AlertDialog onOpenChange={(open) => !open && setDuplicates(null)} open={duplicates !== null}>
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>招聘台中可能已有相同候选人</AlertDialogTitle>
            <AlertDialogDescription>
              系统会基于工作经历、项目经历、技能和岗位画像的语义相似度判断风险。
              请根据判断依据确认是否为同一候选人。确认后会继续创建一条新的招聘台记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ResumeDedupMatchList matches={toResumeDedupMatches(duplicates)} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                setDuplicates(null);
                mutation.mutate("force");
              }}
            >
              仍然入库
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ImportedResumeDetailDialog
        onClose={() => setDetailRecordId(null)}
        recordId={detailRecordId}
      />
    </>
  );
}
