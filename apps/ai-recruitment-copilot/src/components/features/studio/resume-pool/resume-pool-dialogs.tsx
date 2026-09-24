"use client";

import { ResumePoolImportDestinations } from "./resume-pool-import-destinations";
import { EMPTY_IMPORT_OPTIONS } from "./resume-pool-import-selection";
import { BulkUploadDestinations } from "../resumes/bulk-upload-destinations";
import { bulkUploadSelectionModel } from "../resumes/bulk-upload-selection";
import type { BulkUploadSelection } from "../resumes/bulk-upload-selection";

import { IconDatabase, IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ResumePoolScope } from "@arc/db-schema/schema";
import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";
import { resumePoolScopeMeta } from "@arc/shared/resume-pool";
import {
  describeResumeRecruitmentSource,
  MAX_BULK_DESTINATIONS,
} from "@arc/shared/bulk-resume-upload";
import type {
  ResumePoolImportDestination,
  ResumePoolImportDuplicateResult,
  ResumePoolListRecord,
} from "@arc/shared/resume-pool";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getMemberInitials } from "@/components/data-grid/cells/member-cell";
import { TimeDisplay } from "@/components/features/display/time-display";
import { ResumeDedupMatchList } from "@/components/features/resume/resume-dedup-overlay";
import { CopyableResumeRecordId } from "@/components/features/resume/copyable-resume-record-id";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import {
  batchImportResumePoolItem,
  fetchResumePoolImportOptions,
  isApiError,
} from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

import { getCandidateTitle, normalizeScope, toResumeDedupMatches } from "./resume-pool-page-model";
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
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-muted-foreground text-xs font-normal">
                    <CopyableResumeRecordId
                      displayIdClassName="text-xs text-muted-foreground"
                      id={record.resumeRecordId}
                    />
                    <span>·</span>
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
  if (item?.sourceChannel === "historical_import") {
    return "历史简历";
  }
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

function buildInitialRecommendationText(
  item: ResumePoolListRecord,
  jobDescription?: JobDescriptionListRecord,
): string {
  const recruitmentSource = describePoolItemRecruitmentSource(item);
  return buildResumePoolRecommendationTemplate({
    candidateContact: item.candidatePhone ?? item.candidateEmail,
    candidateName: item.candidateName,
    hiringUnitName: jobDescription?.hiringUnitName,
    jobDescriptionName: jobDescription?.name ?? item.jobDescriptionName ?? item.targetRole,
    jobSeries: jobDescription?.jobSeries,
    recruitmentSource,
    referrerName: item.recruitmentSource === "referral" ? item.recruitmentSourceDetail : null,
    resumeContact: jobDescription?.resumeContact,
    serviceUnit: jobDescription?.serviceUnit,
    workYears: item.workYears,
  });
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
  const importOptionsQuery = useQuery({
    enabled: item !== null,
    queryFn: () => fetchResumePoolImportOptions(slug),
    queryKey: ["resume-pool", slug, "import-options"],
    refetchOnWindowFocus: false,
  });
  const options = importOptionsQuery.data ?? EMPTY_IMPORT_OPTIONS;
  const { jobDescriptions } = options;
  const [mode, setMode] = useState<"none" | "bind">("none");
  const [bindSelection, setBindSelection] = useState<BulkUploadSelection>({
    hiringUnitIds: [],
    jobNames: [],
  });
  const [destinations, setDestinations] = useState<ResumePoolImportDestination[]>([]);
  const boundDestinations = bulkUploadSelectionModel(options, bindSelection).destinations.map(
    (job) => ({
      departmentId: job.departmentId ?? null,
      hiringUnitId: job.hiringUnitId,
      jobDescriptionId: job.id,
      serviceUnit: job.serviceUnit ?? null,
    }),
  );
  const activeDestinations = mode === "bind" ? boundDestinations : destinations;
  const requestIdRef = useRef(crypto.randomUUID());
  const submissionFingerprintRef = useRef("");
  const [recommendationText, setRecommendationText] = useState("");
  const [duplicates, setDuplicates] = useState<ResumePoolImportDuplicateResult | null>(null);
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);
  const recommendationItemIdRef = useRef<string | null>(null);
  const recommendationEditedRef = useRef(false);
  const isReimport = Boolean(item?.importedResumeRecordId);

  useEffect(() => {
    if (!item) {
      setMode("none");
      setDestinations([]);
      setBindSelection({ hiringUnitIds: [], jobNames: [] });
      requestIdRef.current = crypto.randomUUID();
      setRecommendationText("");
      setDuplicates(null);
      setDetailRecordId(null);
      recommendationItemIdRef.current = null;
      recommendationEditedRef.current = false;
      return;
    }
    if (!importOptionsQuery.data) {
      return;
    }
    const sourceJobDescription = jobDescriptions.find((jd) => jd.id === item.jobDescriptionId);
    const canUseSourceJd =
      item.scope === "private" && item.jobDescriptionId && sourceJobDescription;
    if (recommendationItemIdRef.current !== item.id) {
      setMode(canUseSourceJd ? "bind" : "none");
      setBindSelection({
        hiringUnitIds: [],
        jobNames: canUseSourceJd ? [sourceJobDescription.name.trim()] : [],
      });
      setDestinations([]);
      requestIdRef.current = crypto.randomUUID();
    }
    if (recommendationItemIdRef.current !== item.id) {
      setRecommendationText(buildInitialRecommendationText(item, sourceJobDescription));
      recommendationItemIdRef.current = item.id;
      recommendationEditedRef.current = false;
    } else if (!recommendationEditedRef.current && sourceJobDescription) {
      setRecommendationText(buildInitialRecommendationText(item, sourceJobDescription));
    }
    setDuplicates(null);
  }, [item, jobDescriptions, importOptionsQuery.data]);

  const mutation = useMutation({
    mutationFn: async (dedupPolicy: "check" | "force") => {
      if (!item) {
        throw new Error("请选择要入库的简历");
      }
      if (activeDestinations.length === 0) {
        throw new Error("请选择入库去向");
      }
      const fingerprint = JSON.stringify({
        destinations: activeDestinations,
        mode,
        recommendationText,
      });
      if (submissionFingerprintRef.current !== fingerprint) {
        requestIdRef.current = crypto.randomUUID();
        submissionFingerprintRef.current = fingerprint;
      }
      return await batchImportResumePoolItem(slug, item.id, {
        dedupPolicy,
        destinations: activeDestinations,
        jobDescriptionMode: mode,
        recommendationText,
        requestId: requestIdRef.current,
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
      toast.success(`已入库到候选人管理，共 ${result.records.length} 条记录`);
      onImported();
      onOpenChange(false);
    },
  });

  const bindInvalid = mode === "bind" && boundDestinations.length === 0;
  const hiringUnitInvalid = activeDestinations.length === 0;
  const { isPending } = mutation;
  const recruitmentSource = describePoolItemRecruitmentSource(item);
  let dialogDescription: string | undefined;
  if (item) {
    dialogDescription = isReimport ? "已在候选人管理，是否再次入库。" : getCandidateTitle(item);
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
              disabled={
                isPending ||
                bindInvalid ||
                hiringUnitInvalid ||
                activeDestinations.length > MAX_BULK_DESTINATIONS ||
                importOptionsQuery.isPending ||
                importOptionsQuery.isError
              }
              onClick={() => mutation.mutate(isReimport ? "force" : "check")}
            >
              {isPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconDatabase className="size-4" />
              )}
              {isReimport ? "确认再次入库" : "确认入库"}
              {activeDestinations.length ? `（${activeDestinations.length} 条记录）` : ""}
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
        title={isReimport ? "再次入库到候选人管理" : "入库到候选人管理"}
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
                onValueChange={(value) => {
                  setMode(value === "bind" ? "bind" : "none");
                  if (value === "none") {
                    setDestinations((rows) =>
                      rows.filter((row) =>
                        options.hiringUnits.some(
                          (unit) =>
                            unit.id === row.hiringUnitId && unit.canImportWithoutJob !== false,
                        ),
                      ),
                    );
                  }
                }}
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
          {importOptionsQuery.isError ? (
            <div role="alert" className="text-sm text-destructive">
              入库选项加载失败。
              <Button variant="link" onClick={() => void importOptionsQuery.refetch()}>
                重试
              </Button>
            </div>
          ) : null}
          {mode === "bind" ? (
            <BulkUploadDestinations
              disabled={isPending || importOptionsQuery.isPending}
              onChange={setBindSelection}
              options={options}
              selection={bindSelection}
            />
          ) : (
            <ResumePoolImportDestinations
              bindJob={false}
              destinations={destinations}
              disabled={isPending || importOptionsQuery.isPending}
              jobName=""
              onChange={setDestinations}
              options={options}
            />
          )}
          {activeDestinations.length > MAX_BULK_DESTINATIONS ? (
            <p className="text-sm text-destructive" role="alert">
              每次最多选择 {MAX_BULK_DESTINATIONS} 个具体岗位去向，请减少选择。
            </p>
          ) : null}
          <Field>
            <FieldLabel>简历来源</FieldLabel>
            <FieldContent>
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {recruitmentSource || "未填写（将原样同步到候选人管理）"}
              </p>
              <p className="text-muted-foreground text-xs">
                入库时会把简历池中的来源复制到候选人管理记录。
              </p>
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel htmlFor="resume-pool-import-recommendation">推荐理由</FieldLabel>
            <FieldContent>
              <Textarea
                disabled={isPending}
                id="resume-pool-import-recommendation"
                maxLength={RESUME_POOL_IMPORT_RECOMMENDATION_MAX_LENGTH}
                onChange={(event) => {
                  recommendationEditedRef.current = true;
                  setRecommendationText(event.target.value);
                }}
                placeholder="例如：期望薪资 30K，预计两周内到岗"
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
            <AlertDialogTitle>候选人管理中可能已有相同候选人</AlertDialogTitle>
            <AlertDialogDescription>
              系统会基于工作经历、项目经历、技能和岗位画像的语义相似度判断风险。
              请根据判断依据确认是否为同一候选人。确认后将按所选组织及对应岗位分别创建候选人管理记录。
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
