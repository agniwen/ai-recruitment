/* oxlint-disable complexity, max-lines -- root form coordinates validation and extracted subforms. */
"use client";

import { IconLoader2 } from "@tabler/icons-react";
import type { CandidateFormTemplateListRecord } from "@arc/db-schema/candidate-forms";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import type { InterviewQuestionTemplateListRecord } from "@arc/db-schema/interview-question-templates";
import { jobDescriptionFormSchema } from "@arc/shared/job-descriptions";
import type { JobDescriptionFormValues, JobDescriptionRecord } from "@arc/shared/job-descriptions";
import type { ResumeScreeningPolicy } from "@arc/shared/resume-screening";
import {
  buildJobDescriptionInterviewerOptions,
  filterInterviewerIdsByDepartment,
  getDepartmentSyncedInterviewerSelection,
} from "@arc/shared/job-description-interviewers";
import { rpc } from "@/lib/client/rpc";
import { withCleanup } from "@/lib/client/async-control";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { useQuery } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/date-time-picker";
import { AnimatedHeight } from "@/components/features/motion/animated-height";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownEditor } from "@/components/features/markdown-editor";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TextareaCounter } from "@/components/ui/textarea-counter";
import { hasFieldErrors, toFieldErrors } from "../interviews/interview-form";
import { ResumeScreeningPolicyFields } from "./job-description-screening-fields";
import {
  LinkedFormsList,
  LinkedInterviewQuestionTemplatesList,
} from "./job-description-linked-resources";
import { useWorkspaceInterviewerMembers } from "../use-workspace-interviewer-members";
import { createJobDescriptionFormValues } from "./job-description-form-values";

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const CONTACT_MAX_LENGTH = 500;
const NOTES_MAX_LENGTH = 2000;
const PROMPT_MAX_LENGTH = 10_000;
const SALARY_RANGE_RAW_MAX_LENGTH = 500;
const SHORT_TEXT_MAX_LENGTH = 120;
const JOB_LEVEL_MAX_LENGTH = 80;
const WORK_TIMEZONE_NONE = "__none__";

/** Common IANA work timezones for the job schedule picker (Chinese-first labels). */
const WORK_TIMEZONE_OPTIONS = [
  { label: "中国标准时间（北京/上海）", value: "Asia/Shanghai" },
  { label: "中国香港", value: "Asia/Hong_Kong" },
  { label: "中国台北", value: "Asia/Taipei" },
  { label: "新加坡", value: "Asia/Singapore" },
  { label: "日本（东京）", value: "Asia/Tokyo" },
  { label: "韩国（首尔）", value: "Asia/Seoul" },
  { label: "泰国（曼谷）", value: "Asia/Bangkok" },
  { label: "印度（加尔各答）", value: "Asia/Kolkata" },
  { label: "阿联酋（迪拜）", value: "Asia/Dubai" },
  { label: "英国（伦敦）", value: "Europe/London" },
  { label: "中欧（柏林）", value: "Europe/Berlin" },
  { label: "中欧（巴黎）", value: "Europe/Paris" },
  { label: "美国东部（纽约）", value: "America/New_York" },
  { label: "美国中部（芝加哥）", value: "America/Chicago" },
  { label: "美国山地（丹佛）", value: "America/Denver" },
  { label: "美国太平洋（洛杉矶）", value: "America/Los_Angeles" },
  { label: "巴西（圣保罗）", value: "America/Sao_Paulo" },
  { label: "澳大利亚（悉尼）", value: "Australia/Sydney" },
  { label: "新西兰（奥克兰）", value: "Pacific/Auckland" },
  { label: "UTC（协调世界时）", value: "UTC" },
] as const;

type JobDescriptionFormTab = "basic" | "screening" | "interview-questions" | "forms";

function FormSection({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={className}>
      <h3 className="mb-3 font-medium text-muted-foreground text-xs tracking-wide">{title}</h3>
      <div className="grid gap-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function toFormValues(record: JobDescriptionRecord): JobDescriptionFormValues {
  return {
    aiInterviewDisabled: record.aiInterviewDisabled,
    allowCrossDepartmentInterviewers: record.allowCrossDepartmentInterviewers,
    code: record.code ?? "",
    controlCategory: record.controlCategory,
    departmentId: record.departmentId,
    description: record.description ?? "",
    expectedOnboardDate: record.expectedOnboardDate,
    gapCount: record.gapCount,
    headcount: record.headcount,
    humanInterviewerIds: [...record.humanInterviewerIds],
    interviewerIds: [...record.interviewerIds],
    jobLevel: record.jobLevel,
    jobSeries: record.jobSeries,
    name: record.name,
    notes: record.notes,
    offeredPendingOnboardCount: record.offeredPendingOnboardCount,
    onboardedCount: record.onboardedCount,
    priority: record.priority,
    prompt: record.prompt,
    recruitmentStatus: record.recruitmentStatus,
    requestedDate: record.requestedDate,
    requester: record.requester ?? "",
    resumeContact: record.resumeContact ?? "",
    resumeScreeningPolicy: record.resumeScreeningPolicy,
    salaryCurrency: record.salaryCurrency,
    salaryMaxAmount: record.salaryMaxAmount,
    salaryMinAmount: record.salaryMinAmount,
    salaryRangeRaw: record.salaryRangeRaw,
    serviceUnit: record.serviceUnit,
    sourceSheet: record.sourceSheet,
    workEndTime: record.workEndTime ?? "",
    workLocation: record.workLocation,
    workStartTime: record.workStartTime ?? "",
    workTimezone: record.workTimezone ?? "",
  };
}

function toDepartmentScopedFormValues(
  record: JobDescriptionRecord,
  interviewers: InterviewerListRecord[],
): JobDescriptionFormValues {
  const values = toFormValues(record);
  return {
    ...values,
    interviewerIds: filterInterviewerIdsByDepartment(
      interviewers,
      values.departmentId,
      values.interviewerIds,
      values.allowCrossDepartmentInterviewers,
    ),
  };
}

function normalizeDepartmentId(value: string | null): string {
  return value ?? "";
}

export function JobDescriptionFormDialog({
  initialDraft,
  open,
  onOpenChange,
  record,
  departments,
  interviewers,
  onSaved,
}: {
  initialDraft?: JobDescriptionFormValues | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: JobDescriptionRecord | null;
  departments: DepartmentRecord[];
  interviewers: InterviewerListRecord[];
  onSaved: () => void;
}) {
  const slug = useWorkspaceSlug();
  const isEdit = record !== null;
  const codeLocked = Boolean(record?.code);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [isGeneratingScreeningPolicy, setIsGeneratingScreeningPolicy] = useState(false);
  const [activeTab, setActiveTab] = useState<JobDescriptionFormTab>("basic");
  const { data: humanInterviewers = [] } = useWorkspaceInterviewerMembers(open);
  const resolvedInitialValues = useMemo(() => {
    if (record) {
      return toDepartmentScopedFormValues(record, interviewers);
    }
    if (initialDraft) {
      return initialDraft;
    }
    return createJobDescriptionFormValues();
  }, [initialDraft, interviewers, record]);

  const { data: linkedForms = [], isLoading: isFormsLoading } = useQuery({
    enabled: open && isEdit && !!record?.id,
    queryFn: async () => {
      const response = await rpc.api.w[":slug"].studio.forms.$get({
        param: { slug },
        query: {
          jobDescriptionId: record?.id ?? "",
          page: "1",
          pageSize: "100",
          sortBy: "createdAt",
          sortOrder: "desc",
        },
      });
      const payload = (await response.json()) as {
        records?: CandidateFormTemplateListRecord[];
        error?: string;
      } | null;
      if (!response.ok || !payload?.records) {
        throw new Error(payload?.error ?? "加载关联表单题失败");
      }
      return payload.records;
    },
    queryKey: ["job-description-linked-forms", slug, record?.id],
  });

  const { data: linkedInterviewQuestions = [], isLoading: isInterviewQuestionsLoading } = useQuery({
    enabled: open && isEdit && !!record?.id,
    queryFn: async () => {
      const response = await rpc.api.w[":slug"].studio["interview-questions"].$get({
        param: { slug },
        query: {
          jobDescriptionId: record?.id ?? "",
          page: "1",
          pageSize: "100",
          sortBy: "createdAt",
          sortOrder: "desc",
        },
      });
      const payload = (await response.json()) as {
        records?: InterviewQuestionTemplateListRecord[];
        error?: string;
      } | null;
      if (!response.ok || !payload?.records) {
        throw new Error(payload?.error ?? "加载关联沟通题失败");
      }
      return payload.records;
    },
    queryKey: ["job-description-linked-interview-questions", slug, record?.id],
  });

  const form = useForm({
    defaultValues: resolvedInitialValues,
    onSubmit: async ({ value }) => {
      const body = {
        aiInterviewDisabled: value.aiInterviewDisabled,
        allowCrossDepartmentInterviewers: value.allowCrossDepartmentInterviewers,
        code: value.code?.trim() || undefined,
        controlCategory: value.controlCategory?.trim() || null,
        departmentId: value.departmentId,
        description: value.description?.trim() || "",
        expectedOnboardDate: value.expectedOnboardDate?.trim() || null,
        gapCount: value.gapCount ?? null,
        headcount: value.headcount ?? null,
        humanInterviewerIds: value.humanInterviewerIds,
        interviewerIds: value.interviewerIds,
        jobLevel: value.jobLevel?.trim() || null,
        jobSeries: value.jobSeries?.trim() || null,
        name: value.name.trim(),
        notes: value.notes?.trim() || null,
        offeredPendingOnboardCount: value.offeredPendingOnboardCount ?? null,
        onboardedCount: value.onboardedCount ?? null,
        priority: value.priority,
        prompt: value.prompt.trim(),
        recruitmentStatus: value.recruitmentStatus?.trim() || null,
        requestedDate: value.requestedDate?.trim() || null,
        requester: value.requester?.trim() || null,
        resumeContact: value.resumeContact?.trim() || null,
        resumeScreeningPolicy: value.resumeScreeningPolicy,
        salaryCurrency: value.salaryCurrency?.trim() || null,
        salaryMaxAmount: value.salaryMaxAmount ?? null,
        salaryMinAmount: value.salaryMinAmount ?? null,
        salaryRangeRaw: value.salaryRangeRaw?.trim() || null,
        serviceUnit: value.serviceUnit?.trim() || null,
        sourceSheet: value.sourceSheet?.trim() || null,
        workEndTime: value.workEndTime?.trim() || null,
        workLocation: value.workLocation?.trim() || null,
        workStartTime: value.workStartTime?.trim() || null,
        workTimezone: value.workTimezone?.trim() || null,
      };

      const response = isEdit
        ? await rpc.api.w[":slug"].studio["job-descriptions"][":id"].$patch({
            json: body,
            param: { id: record.id, slug },
          })
        : await rpc.api.w[":slug"].studio["job-descriptions"].$post({
            json: body,
            param: { slug },
          });
      const payload = (await response.json().catch(() => null)) as
        | ({ error?: string } & Partial<JobDescriptionRecord>)
        | null;
      if (!response.ok) {
        toast.error(payload?.error ?? (isEdit ? "更新失败" : "创建失败"));
        return;
      }
      toast.success(isEdit ? "在招岗位已更新" : "在招岗位已创建");
      onSaved();
      onOpenChange(false);
    },
    onSubmitInvalid: ({ formApi }) => {
      const meta = formApi.store.state.fieldMeta as Record<string, { errors?: unknown[] }>;
      const basicFields = [
        "code",
        "name",
        "departmentId",
        "allowCrossDepartmentInterviewers",
        "aiInterviewDisabled",
        "interviewerIds",
        "description",
        "humanInterviewerIds",
        "priority",
        "prompt",
        "requester",
        "resumeContact",
        "workEndTime",
        "workStartTime",
        "workTimezone",
      ];
      const screeningFields = ["resumeScreeningPolicy"];
      const hasBasicError = basicFields.some((key) => (meta[key]?.errors?.length ?? 0) > 0);
      const hasScreeningError = screeningFields.some((key) => (meta[key]?.errors?.length ?? 0) > 0);
      if (hasBasicError) {
        setActiveTab("basic");
      } else if (hasScreeningError) {
        setActiveTab("screening");
      }
    },
    validators: { onSubmit: jobDescriptionFormSchema },
  });

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const allowCrossDepartmentInterviewers = useStore(
    form.store,
    (state) => state.values.allowCrossDepartmentInterviewers,
  );
  const selectedDepartmentId = useStore(form.store, (state) => state.values.departmentId);
  const selectedInterviewerIds = useStore(form.store, (state) => state.values.interviewerIds);
  const interviewerOptions = useMemo(
    () =>
      buildJobDescriptionInterviewerOptions(
        interviewers,
        selectedDepartmentId,
        allowCrossDepartmentInterviewers,
      ),
    [allowCrossDepartmentInterviewers, interviewers, selectedDepartmentId],
  );

  useEffect(() => {
    if (open) {
      form.reset(resolvedInitialValues);
      setActiveTab("basic");
    }
  }, [open, form, resolvedInitialValues]);

  const missingRefs = departments.length === 0;

  async function handleGenerateCode() {
    setIsGeneratingCode(true);
    await withCleanup(
      async () => {
        const response = await rpc.api.w[":slug"].studio["job-descriptions"]["generate-code"].$post(
          {
            param: { slug },
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          code?: string;
          error?: string;
        } | null;
        if (!response.ok || !payload?.code) {
          toast.error(payload?.error ?? "生成岗位编码失败");
          return;
        }
        form.setFieldValue("code", payload.code);
      },
      () => setIsGeneratingCode(false),
    );
  }

  async function handleGenerateScreeningPolicy() {
    const { values } = form.store.state;
    if (!values.prompt.trim()) {
      toast.error("请先填写岗位 Prompt");
      return;
    }
    setIsGeneratingScreeningPolicy(true);
    await withCleanup(
      async () => {
        const response = await rpc.api.w[":slug"].studio["job-descriptions"][
          "generate-screening-policy"
        ].$post({
          json: {
            description: values.description?.trim() || undefined,
            name: values.name.trim() || undefined,
            prompt: values.prompt.trim(),
          },
          param: { slug },
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          policy?: ResumeScreeningPolicy;
        } | null;
        if (!response.ok || !payload?.policy) {
          toast.error(payload?.error ?? "筛选规则生成失败");
          return;
        }
        form.setFieldValue("resumeScreeningPolicy", payload.policy);
        toast.success(
          payload.policy.rules.length > 0 ? "已生成筛选规则草稿" : "JD 中未发现明确筛选规则",
        );
      },
      () => setIsGeneratingScreeningPolicy(false),
    );
  }

  return (
    <Tabs onValueChange={(value) => setActiveTab(value as JobDescriptionFormTab)} value={activeTab}>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? "编辑在招岗位" : "新建在招岗位"}
        description="维护岗位基础信息、招聘进度与面试配置；Google 文档同步字段可在此查看与修改。"
        size="2xl"
        headerExtra={
          <TabsList className="mt-2">
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="screening">筛选规则</TabsTrigger>
            {isEdit ? <TabsTrigger value="interview-questions">沟通题</TabsTrigger> : null}
            {isEdit ? <TabsTrigger value="forms">表单题</TabsTrigger> : null}
          </TabsList>
        }
        footer={
          <>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              取消
            </Button>
            <Button
              disabled={isSubmitting || missingRefs}
              form="job-description-form"
              type="submit"
            >
              {isSubmitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {isEdit ? "保存" : "创建"}
            </Button>
          </>
        }
      >
        <form
          id="job-description-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <AnimatedHeight>
            <TabsContent value="basic">
              <FieldGroup className="mt-4 gap-8">
                <FormSection title="基础信息">
                  <form.Field name="name">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>
                            岗位名称 <span className="text-destructive">*</span>
                          </FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={NAME_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder="如：高级前端工程师"
                              value={field.state.value}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="code">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      const canGenerateCode = !codeLocked && !isGeneratingCode;
                      let codeButtonLabel = "生成";
                      if (codeLocked) {
                        codeButtonLabel = "已生成";
                      } else if (isGeneratingCode) {
                        codeButtonLabel = "生成中";
                      }
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>岗位编码（稳定唯一值）</FieldLabel>
                          <FieldContent className="gap-2">
                            <InputGroup>
                              <InputGroupInput
                                aria-invalid={!!errors?.length}
                                className={
                                  field.state.value ? "font-mono" : "text-muted-foreground"
                                }
                                id={field.name}
                                placeholder="保存时自动生成"
                                readOnly
                                value={field.state.value ?? ""}
                              />
                              <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                  disabled={!canGenerateCode}
                                  onClick={handleGenerateCode}
                                  type="button"
                                >
                                  {codeButtonLabel}
                                </InputGroupButton>
                              </InputGroupAddon>
                            </InputGroup>
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="departmentId">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>
                            所属部门 <span className="text-destructive">*</span>
                          </FieldLabel>
                          <FieldContent className="gap-2">
                            <SearchableSelect
                              id={field.name}
                              invalid={!!errors?.length}
                              onChange={(value) => {
                                const nextDepartmentId = normalizeDepartmentId(value);
                                field.handleChange(nextDepartmentId);
                                form.setFieldValue(
                                  "interviewerIds",
                                  filterInterviewerIdsByDepartment(
                                    interviewers,
                                    nextDepartmentId,
                                    selectedInterviewerIds,
                                    allowCrossDepartmentInterviewers,
                                  ),
                                );
                              }}
                              options={departments.map((dept) => ({
                                label: dept.name,
                                value: dept.id,
                              }))}
                              placeholder="选择部门"
                              searchPlaceholder="搜索部门…"
                              value={field.state.value || null}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="priority">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>优先级</FieldLabel>
                          <FieldContent className="gap-2">
                            <Select
                              onValueChange={(value) => value && field.handleChange(value)}
                              value={field.state.value}
                            >
                              <SelectTrigger
                                aria-invalid={!!errors?.length}
                                className="w-full"
                                id={field.name}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="P0">P0（紧急/高）</SelectItem>
                                <SelectItem value="P1">P1（中）</SelectItem>
                                <SelectItem value="P2">P2（低）</SelectItem>
                              </SelectContent>
                            </Select>
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="recruitmentStatus">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>招聘状态</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SHORT_TEXT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：招聘中"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="controlCategory">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>岗位管控分类</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SHORT_TEXT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：C类-正常招聘"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="jobSeries">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>序列</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SHORT_TEXT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：直属"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="jobLevel">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>职级</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={JOB_LEVEL_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：P4-P5"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="serviceUnit">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>服务单位</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SHORT_TEXT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：天枢"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="workLocation">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>工作地点</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SHORT_TEXT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：远程 / 上海"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="sourceSheet">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>来源表格</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SHORT_TEXT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：技术中心"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="salaryRangeRaw">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>薪资范围</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={SALARY_RANGE_RAW_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value || null)}
                              placeholder="如：15-25K / 面议"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>
                </FormSection>

                <FormSection title="招聘进度">
                  <form.Field name="headcount">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>HC</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              inputMode="numeric"
                              min={0}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(parseOptionalInt(event.target.value))
                              }
                              placeholder="编制人数"
                              type="number"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="onboardedCount">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>已到岗</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              inputMode="numeric"
                              min={0}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(parseOptionalInt(event.target.value))
                              }
                              type="number"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="gapCount">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>缺口</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              inputMode="numeric"
                              min={0}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(parseOptionalInt(event.target.value))
                              }
                              type="number"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="offeredPendingOnboardCount">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>已发 offer 待入职</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              inputMode="numeric"
                              min={0}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(parseOptionalInt(event.target.value))
                              }
                              type="number"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="requestedDate">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>提需日期</FieldLabel>
                          <FieldContent className="gap-2">
                            <DatePicker
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              onBlur={field.handleBlur}
                              onValueChange={(next) => field.handleChange(next || null)}
                              placeholder="选择提需日期"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="expectedOnboardDate">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>期望到岗日期</FieldLabel>
                          <FieldContent className="gap-2">
                            <DatePicker
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              onBlur={field.handleBlur}
                              onValueChange={(next) => field.handleChange(next || null)}
                              placeholder="选择期望到岗日期"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>
                </FormSection>

                <FormSection title="联系人">
                  <form.Field name="requester">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>需求发起人</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={CONTACT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder="请输入需求发起人"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="resumeContact">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>简历对接人</FieldLabel>
                          <FieldContent className="gap-2">
                            <Input
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={CONTACT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              placeholder="请输入简历对接人"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>
                </FormSection>

                <FormSection title="工作时间">
                  <form.Field name="workTimezone">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      const selectedTimezone = field.state.value?.trim() || "";
                      const knownValues = new Set<string>(
                        WORK_TIMEZONE_OPTIONS.map((option) => option.value),
                      );
                      const hasLegacyTimezone =
                        selectedTimezone.length > 0 && !knownValues.has(selectedTimezone);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>工作时区</FieldLabel>
                          <FieldContent className="gap-2">
                            <Select
                              onValueChange={(value) =>
                                field.handleChange(
                                  !value || value === WORK_TIMEZONE_NONE ? "" : value,
                                )
                              }
                              value={selectedTimezone || WORK_TIMEZONE_NONE}
                            >
                              <SelectTrigger
                                aria-invalid={!!errors?.length}
                                className="w-full"
                                id={field.name}
                              >
                                <SelectValue placeholder="选择工作时区" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={WORK_TIMEZONE_NONE}>未设置</SelectItem>
                                {hasLegacyTimezone ? (
                                  <SelectItem value={selectedTimezone}>
                                    {selectedTimezone}（当前值）
                                  </SelectItem>
                                ) : null}
                                {WORK_TIMEZONE_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <div className="grid gap-3 sm:grid-cols-2 md:col-span-1">
                    <form.Field name="workStartTime">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>工作开始时间</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                step={60}
                                type="time"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                    <form.Field name="workEndTime">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>工作结束时间</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                step={60}
                                type="time"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>
                </FormSection>

                <FormSection title="面试配置">
                  <form.Field name="allowCrossDepartmentInterviewers">
                    {(field) => (
                      <Field className="md:col-span-2">
                        <Card className="gap-0 rounded-lg py-0">
                          <CardContent className="flex items-center justify-between gap-4 px-3 py-2.5">
                            <div className="space-y-0.5">
                              <FieldLabel htmlFor={field.name}>允许匹配跨部门面试官</FieldLabel>
                              <p className="text-muted-foreground text-xs">
                                关闭时只能选择所属部门下的面试官；开启后可选择任意部门的面试官。
                              </p>
                            </div>
                            <Switch
                              checked={field.state.value}
                              id={field.name}
                              onCheckedChange={(checked) => {
                                field.handleChange(checked);
                                if (!checked) {
                                  form.setFieldValue(
                                    "interviewerIds",
                                    filterInterviewerIdsByDepartment(
                                      interviewers,
                                      selectedDepartmentId,
                                      selectedInterviewerIds,
                                      false,
                                    ),
                                  );
                                }
                              }}
                            />
                          </CardContent>
                        </Card>
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="aiInterviewDisabled">
                    {(field) => (
                      <Field className="md:col-span-2">
                        <Card className="gap-0 rounded-lg py-0">
                          <CardContent className="flex items-center justify-between gap-4 px-3 py-2.5">
                            <div className="space-y-0.5">
                              <FieldLabel htmlFor={field.name}>禁用 AI 面试</FieldLabel>
                              <p className="text-muted-foreground text-xs">
                                开启后，关联该岗位的候选人不能从简历筛选阶段发起 AI 面试。
                              </p>
                            </div>
                            <Switch
                              checked={field.state.value}
                              id={field.name}
                              onCheckedChange={field.handleChange}
                            />
                          </CardContent>
                        </Card>
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="interviewerIds">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field
                          className="md:col-span-2"
                          data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                        >
                          <FieldLabel>AI面试官（可选）</FieldLabel>
                          <FieldContent className="gap-2">
                            <SearchableMultiSelect
                              emptyMessage="没有匹配的 AI面试官"
                              invalid={!!errors?.length}
                              onChange={(next) => {
                                const synced = getDepartmentSyncedInterviewerSelection({
                                  allowCrossDepartmentInterviewers,
                                  currentDepartmentId: selectedDepartmentId,
                                  interviewers,
                                  nextInterviewerIds: next,
                                  previousInterviewerIds: field.state.value,
                                });
                                if (synced.departmentId !== selectedDepartmentId) {
                                  form.setFieldValue("departmentId", synced.departmentId);
                                }
                                field.handleChange(synced.interviewerIds);
                              }}
                              options={interviewerOptions}
                              placeholder="选择 AI面试官…"
                              searchPlaceholder="搜索 AI面试官…"
                              selectedFormat={(count) => `已选 ${count} 位 AI面试官`}
                              selectedPreviewLimit={3}
                              value={field.state.value}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="humanInterviewerIds">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field
                          className="md:col-span-2"
                          data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                        >
                          <FieldLabel>真人面试官（可选）</FieldLabel>
                          <FieldContent className="gap-2">
                            <SearchableMultiSelect
                              emptyMessage="没有可选的真人面试官"
                              invalid={!!errors?.length}
                              onChange={field.handleChange}
                              options={humanInterviewers.map((member) => ({
                                label: member.name,
                                value: member.id,
                              }))}
                              placeholder="选择真人面试官…"
                              searchPlaceholder="搜索真人面试官…"
                              selectedFormat={(count) => `已选 ${count} 位真人面试官`}
                              selectedPreviewLimit={3}
                              value={field.state.value}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>
                </FormSection>

                <FormSection className="md:[&>div]:grid-cols-1" title="岗位说明与 JD">
                  <form.Field name="description">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>描述</FieldLabel>
                          <FieldContent className="gap-2">
                            <div className="relative">
                              <Textarea
                                aria-invalid={!!errors?.length}
                                className="min-h-20 pb-6"
                                id={field.name}
                                maxLength={DESCRIPTION_MAX_LENGTH}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                placeholder="简要描述岗位职责、要求等"
                                value={field.state.value ?? ""}
                              />
                              <TextareaCounter
                                maxLength={DESCRIPTION_MAX_LENGTH}
                                value={field.state.value}
                              />
                            </div>
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="prompt">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>
                            岗位 Prompt / JD <span className="text-destructive">*</span>
                          </FieldLabel>
                          <FieldContent className="gap-2">
                            <MarkdownEditor
                              aria-invalid={!!errors?.length}
                              id={field.name}
                              maxLength={PROMPT_MAX_LENGTH}
                              onBlur={field.handleBlur}
                              onChange={field.handleChange}
                              placeholder="岗位职责 + 任职要求（与表格 JD 列对应）"
                              value={field.state.value}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <form.Field name="notes">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}>
                          <FieldLabel htmlFor={field.name}>备注说明</FieldLabel>
                          <FieldContent className="gap-2">
                            <div className="relative">
                              <Textarea
                                aria-invalid={!!errors?.length}
                                className="min-h-20 pb-6"
                                id={field.name}
                                maxLength={NOTES_MAX_LENGTH}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value || null)}
                                placeholder="非远程岗位请备注工作地点等"
                                value={field.state.value ?? ""}
                              />
                              <TextareaCounter
                                maxLength={NOTES_MAX_LENGTH}
                                value={field.state.value ?? ""}
                              />
                            </div>
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>
                </FormSection>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="screening">
              <form.Field name="resumeScreeningPolicy">
                {(field) => (
                  <ResumeScreeningPolicyFields
                    isGenerating={isGeneratingScreeningPolicy}
                    onGenerateFromJobDescription={handleGenerateScreeningPolicy}
                    onChange={field.handleChange}
                    policy={field.state.value}
                  />
                )}
              </form.Field>
            </TabsContent>
            {isEdit ? (
              <TabsContent value="interview-questions">
                {/* oxlint-disable-next-line no-use-before-define */}
                <LinkedInterviewQuestionTemplatesList
                  isLoading={isInterviewQuestionsLoading}
                  jobDescriptionId={record?.id ?? ""}
                  templates={linkedInterviewQuestions}
                />
              </TabsContent>
            ) : null}
            {isEdit ? (
              <TabsContent value="forms">
                {/* oxlint-disable-next-line no-use-before-define */}
                <LinkedFormsList
                  isLoading={isFormsLoading}
                  jobDescriptionId={record?.id ?? ""}
                  templates={linkedForms}
                />
              </TabsContent>
            ) : null}
          </AnimatedHeight>
        </form>
      </Modal>
    </Tabs>
  );
}
