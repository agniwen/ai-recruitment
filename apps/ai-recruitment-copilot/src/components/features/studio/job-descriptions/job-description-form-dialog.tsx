"use client";

import type { CandidateFormTemplateListRecord } from "@arc/db-schema/candidate-forms";
import type { DepartmentRecord } from "@arc/shared/departments";
import type { InterviewerListRecord } from "@arc/shared/interviewers";
import type { InterviewQuestionTemplateListRecord } from "@arc/db-schema/interview-question-templates";
import {
  createDefaultResumeScreeningPolicy,
  jobDescriptionFormSchema,
} from "@arc/shared/job-descriptions";
import type { JobDescriptionFormValues, JobDescriptionRecord } from "@arc/shared/job-descriptions";
import { dateOnlyStringToLocalDate, localDateToDateOnlyString } from "@arc/shared/date-only";
import type {
  ResumeScreeningFieldRule,
  ResumeScreeningPolicy,
  ResumeScreeningRuleSeverity,
  ResumeScreeningSkillRule,
} from "@arc/shared/resume-screening";
import {
  buildJobDescriptionInterviewerOptions,
  filterInterviewerIdsByDepartment,
  getDepartmentSyncedInterviewerSelection,
} from "@arc/shared/job-description-interviewers";
import { rpc } from "@/lib/client/rpc";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { useQuery } from "@tanstack/react-query";
import { useForm, useStore } from "@tanstack/react-form";
import {
  IconCalendar as CalendarDaysIcon,
  IconClipboardList as ClipboardListIcon,
  IconExternalLink as ExternalLinkIcon,
  IconListCheck as ListChecksIcon,
  IconLoader2 as LoaderCircleIcon,
  IconSparkles as SparklesIcon,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AnimatedHeight } from "@/components/features/motion/animated-height";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownEditor } from "@/components/features/markdown-editor";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TextareaCounter } from "@/components/ui/textarea-counter";
import { hasFieldErrors, toFieldErrors } from "../interviews/interview-form";

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const PROMPT_MAX_LENGTH = 10_000;
const SCREENING_TEXTAREA_MAX_LENGTH = 2000;
const MIN_EDUCATION_RULE_ID = "minimum-education";
const MIN_WORK_YEARS_RULE_ID = "minimum-work-years";
const REQUIRED_SKILLS_RULE_ID = "required-skills";
const SALARY_CURRENCY_OPTIONS = [
  { label: "CNY · 人民币", value: "CNY" },
  { label: "TWD · 新台币", value: "TWD" },
  { label: "USD · 美元", value: "USD" },
  { label: "HKD · 港币", value: "HKD" },
  { label: "SGD · 新加坡元", value: "SGD" },
  { label: "JPY · 日元", value: "JPY" },
] as const;

type JobDescriptionFormTab = "basic" | "screening" | "interview-questions" | "forms";
type MinimumEducationRule = Extract<ResumeScreeningFieldRule, { field: "minimumEducation" }>;
type MinimumWorkYearsRule = Extract<ResumeScreeningFieldRule, { field: "minimumWorkYears" }>;

export function emptyJobDescriptionFormValues(): JobDescriptionFormValues {
  return {
    allowCrossDepartmentInterviewers: false,
    code: "",
    controlCategory: null,
    departmentId: "",
    description: "",
    expectedOnboardDate: null,
    gapCount: null,
    headcount: null,
    interviewerIds: [],
    jobLevel: null,
    jobSeries: null,
    name: "",
    notes: null,
    offeredPendingOnboardCount: null,
    onboardedCount: null,
    priority: null,
    prompt: "",
    recruitmentStatus: null,
    requestedDate: null,
    requester: null,
    resumeContact: null,
    resumeScreeningPolicy: createDefaultResumeScreeningPolicy(),
    salaryCurrency: null,
    salaryMaxAmount: null,
    salaryMinAmount: null,
    serviceUnit: null,
    sourceSheet: null,
    workLocation: null,
  };
}

function toFormValues(record: JobDescriptionRecord): JobDescriptionFormValues {
  return {
    allowCrossDepartmentInterviewers: record.allowCrossDepartmentInterviewers,
    code: record.code ?? "",
    controlCategory: record.controlCategory,
    departmentId: record.departmentId,
    description: record.description ?? "",
    expectedOnboardDate: record.expectedOnboardDate,
    gapCount: record.gapCount,
    headcount: record.headcount,
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
    requester: record.requester,
    resumeContact: record.resumeContact,
    resumeScreeningPolicy: record.resumeScreeningPolicy,
    salaryCurrency: record.salaryCurrency,
    salaryMaxAmount: record.salaryMaxAmount,
    salaryMinAmount: record.salaryMinAmount,
    serviceUnit: record.serviceUnit,
    sourceSheet: record.sourceSheet,
    workLocation: record.workLocation,
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

function parseOptionalIntegerInput(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalTextInput(value: string): string | null {
  return value.trim() || null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function normalizeOptionalCode(value: string | null | undefined): string | undefined {
  return normalizeOptionalText(value) ?? undefined;
}

function normalizeOptionalDescription(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? "";
}

function toSubmitBody(value: JobDescriptionFormValues) {
  return {
    allowCrossDepartmentInterviewers: value.allowCrossDepartmentInterviewers,
    code: normalizeOptionalCode(value.code),
    controlCategory: normalizeOptionalText(value.controlCategory),
    departmentId: value.departmentId,
    description: normalizeOptionalDescription(value.description),
    expectedOnboardDate: normalizeOptionalText(value.expectedOnboardDate),
    gapCount: value.gapCount ?? null,
    headcount: value.headcount ?? null,
    interviewerIds: value.interviewerIds,
    jobLevel: normalizeOptionalText(value.jobLevel),
    jobSeries: normalizeOptionalText(value.jobSeries),
    name: value.name.trim(),
    notes: normalizeOptionalText(value.notes),
    offeredPendingOnboardCount: value.offeredPendingOnboardCount ?? null,
    onboardedCount: value.onboardedCount ?? null,
    priority: normalizeOptionalText(value.priority),
    prompt: value.prompt.trim(),
    recruitmentStatus: normalizeOptionalText(value.recruitmentStatus),
    requestedDate: normalizeOptionalText(value.requestedDate),
    requester: normalizeOptionalText(value.requester),
    resumeContact: normalizeOptionalText(value.resumeContact),
    resumeScreeningPolicy: value.resumeScreeningPolicy,
    salaryCurrency: normalizeOptionalText(value.salaryCurrency),
    salaryMaxAmount: value.salaryMaxAmount ?? null,
    salaryMinAmount: value.salaryMinAmount ?? null,
    serviceUnit: normalizeOptionalText(value.serviceUnit),
    sourceSheet: normalizeOptionalText(value.sourceSheet),
    workLocation: normalizeOptionalText(value.workLocation),
  };
}

function DateOnlyPickerField({
  errors,
  id,
  invalid,
  label,
  onBlur,
  onChange,
  value,
}: {
  errors?: ({ message?: string } | undefined)[];
  id: string;
  invalid: boolean;
  label: string;
  onBlur: () => void;
  onChange: (value: string | null) => void;
  value: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = dateOnlyStringToLocalDate(value);

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldContent className="gap-2">
        <div className="flex gap-2">
          <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger
              render={
                <Button
                  aria-invalid={invalid || undefined}
                  className="flex-1 justify-start font-normal"
                  id={id}
                  onBlur={onBlur}
                  type="button"
                  variant="outline"
                >
                  <CalendarDaysIcon data-icon="inline-start" />
                  {value || "选择日期"}
                </Button>
              }
            />
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                onSelect={(date) => {
                  onChange(date ? localDateToDateOnlyString(date) : null);
                  setOpen(false);
                }}
                selected={selectedDate ?? undefined}
              />
            </PopoverContent>
          </Popover>
          {value ? (
            <Button onClick={() => onChange(null)} type="button" variant="outline">
              清空
            </Button>
          ) : null}
        </div>
        <FieldError errors={errors} />
      </FieldContent>
    </Field>
  );
}

function splitRuleLines(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinRuleLines(values: string[]) {
  return values.join("\n");
}

function upsertRule<TRule extends ResumeScreeningPolicy["rules"][number]>(
  rules: ResumeScreeningPolicy["rules"],
  nextRule: TRule,
) {
  return [...rules.filter((rule) => rule.id !== nextRule.id), nextRule];
}

function removeRule(
  rules: ResumeScreeningPolicy["rules"],
  id: string,
): ResumeScreeningPolicy["rules"] {
  return rules.filter((rule) => rule.id !== id);
}

function getMinimumEducationRule(policy: ResumeScreeningPolicy) {
  return policy.rules.find(
    (rule): rule is MinimumEducationRule =>
      rule.type === "field" && rule.field === "minimumEducation",
  );
}

function getMinimumWorkYearsRule(policy: ResumeScreeningPolicy) {
  return policy.rules.find(
    (rule): rule is MinimumWorkYearsRule =>
      rule.type === "field" && rule.field === "minimumWorkYears",
  );
}

function getRequiredSkillsRule(policy: ResumeScreeningPolicy) {
  return policy.rules.find((rule): rule is ResumeScreeningSkillRule => rule.type === "skill");
}

const SCREENING_SEVERITY_OPTIONS = [
  { label: "暂缓推进", value: "blocking" },
  { label: "需核实", value: "warning" },
  { label: "仅记录", value: "info" },
];

function ResumeScreeningPolicyFields({
  isGenerating,
  onGenerateFromJobDescription,
  onChange,
  policy,
}: {
  isGenerating: boolean;
  onGenerateFromJobDescription: () => void;
  onChange: (policy: ResumeScreeningPolicy) => void;
  policy: ResumeScreeningPolicy;
}) {
  const minimumEducationRule = getMinimumEducationRule(policy);
  const minimumWorkYearsRule = getMinimumWorkYearsRule(policy);
  const requiredSkillsRule = getRequiredSkillsRule(policy);
  const semanticRules = policy.rules.filter((rule) => rule.type === "semantic");
  const skillSeverity = requiredSkillsRule?.severity ?? "warning";
  const semanticSeverity = semanticRules[0]?.severity ?? "warning";

  function patchPolicy(next: Partial<ResumeScreeningPolicy>) {
    onChange({ ...policy, ...next });
  }

  function setMinimumEducation(level: MinimumEducationRule["level"]) {
    patchPolicy({
      rules: upsertRule(policy.rules, {
        field: "minimumEducation",
        id: MIN_EDUCATION_RULE_ID,
        level,
        severity: minimumEducationRule?.severity ?? "blocking",
        type: "field",
      }),
    });
  }

  function setMinimumWorkYears(value: string) {
    const years = Number.parseInt(value, 10);
    if (!Number.isFinite(years) || years <= 0) {
      patchPolicy({ rules: removeRule(policy.rules, MIN_WORK_YEARS_RULE_ID) });
      return;
    }
    patchPolicy({
      rules: upsertRule(policy.rules, {
        field: "minimumWorkYears",
        id: MIN_WORK_YEARS_RULE_ID,
        severity: minimumWorkYearsRule?.severity ?? "blocking",
        type: "field",
        years,
      }),
    });
  }

  function setRequiredSkills(value: string) {
    const requiredSkills = splitRuleLines(value);
    if (requiredSkills.length === 0) {
      patchPolicy({ rules: removeRule(policy.rules, REQUIRED_SKILLS_RULE_ID) });
      return;
    }
    patchPolicy({
      rules: upsertRule(policy.rules, {
        id: REQUIRED_SKILLS_RULE_ID,
        matchMode: requiredSkillsRule?.matchMode ?? { type: "all" },
        requiredSkills,
        severity: skillSeverity,
        type: "skill",
      }),
    });
  }

  function setSemanticRules(value: string) {
    const requirements = splitRuleLines(value);
    const nonSemanticRules = policy.rules.filter((rule) => rule.type !== "semantic");
    patchPolicy({
      rules: [
        ...nonSemanticRules,
        ...requirements.map((requirement, index) => ({
          id: `semantic-${index + 1}`,
          requirement,
          severity: semanticSeverity,
          type: "semantic" as const,
        })),
      ],
    });
  }

  return (
    <FieldGroup className="mt-4 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium text-sm">筛选规则草稿</p>
          <p className="text-muted-foreground text-xs">
            用于简历筛选阶段生成通过、需核实或暂缓推进建议。
          </p>
        </div>
        <Button
          disabled={isGenerating}
          onClick={onGenerateFromJobDescription}
          size="sm"
          type="button"
          variant="outline"
        >
          {isGenerating ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <SparklesIcon data-icon="inline-start" />
          )}
          从 JD 生成
        </Button>
      </div>

      <Card className="gap-0 rounded-lg py-0">
        <CardContent className="flex items-center justify-between gap-4 px-3 py-2.5">
          <div className="space-y-0.5">
            <FieldLabel htmlFor="resume-screening-enabled">启用简历筛选规则</FieldLabel>
            <p className="text-muted-foreground text-xs">关闭后仅保留规则草稿，不参与筛选。</p>
          </div>
          <Switch
            checked={policy.enabled}
            id="resume-screening-enabled"
            onCheckedChange={(enabled) => patchPolicy({ enabled })}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Field>
          <FieldLabel>最低学历</FieldLabel>
          <FieldContent className="gap-2">
            <SearchableSelect
              onChange={(value) =>
                setMinimumEducation((value ?? "none") as MinimumEducationRule["level"])
              }
              options={["none", "专科", "本科", "硕士", "博士"].map((value) => ({
                label: value === "none" ? "不限" : value,
                value,
              }))}
              placeholder="不限"
              value={minimumEducationRule?.level ?? "none"}
            />
            <SearchableSelect
              disabled={!minimumEducationRule}
              onChange={(value) => {
                if (minimumEducationRule) {
                  patchPolicy({
                    rules: upsertRule(policy.rules, {
                      ...minimumEducationRule,
                      severity: (value ?? "blocking") as ResumeScreeningRuleSeverity,
                    }),
                  });
                }
              }}
              options={SCREENING_SEVERITY_OPTIONS}
              placeholder="暂缓推进"
              value={minimumEducationRule?.severity ?? "blocking"}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="minimum-work-years">最低工作年限</FieldLabel>
          <FieldContent className="gap-2">
            <Input
              id="minimum-work-years"
              min={0}
              onChange={(event) => setMinimumWorkYears(event.target.value)}
              placeholder="不限"
              type="number"
              value={minimumWorkYearsRule?.years ?? ""}
            />
            <SearchableSelect
              disabled={!minimumWorkYearsRule}
              onChange={(value) => {
                if (minimumWorkYearsRule) {
                  patchPolicy({
                    rules: upsertRule(policy.rules, {
                      ...minimumWorkYearsRule,
                      severity: (value ?? "blocking") as ResumeScreeningRuleSeverity,
                    }),
                  });
                }
              }}
              options={SCREENING_SEVERITY_OPTIONS}
              placeholder="暂缓推进"
              value={minimumWorkYearsRule?.severity ?? "blocking"}
            />
          </FieldContent>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="required-skills">必备技能</FieldLabel>
        <FieldContent className="gap-3">
          <Textarea
            className="min-h-24"
            id="required-skills"
            maxLength={SCREENING_TEXTAREA_MAX_LENGTH}
            onChange={(event) => setRequiredSkills(event.target.value)}
            placeholder="每行一个技能，例如 React、TypeScript、Node.js"
            value={joinRuleLines(requiredSkillsRule?.requiredSkills ?? [])}
          />
          <SearchableSelect
            disabled={!requiredSkillsRule}
            onChange={(value) => {
              if (requiredSkillsRule) {
                patchPolicy({
                  rules: upsertRule(policy.rules, {
                    ...requiredSkillsRule,
                    severity: (value ?? "warning") as ResumeScreeningRuleSeverity,
                  }),
                });
              }
            }}
            options={SCREENING_SEVERITY_OPTIONS}
            placeholder="需核实"
            value={skillSeverity}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="semantic-screening-rules">其他语义要求</FieldLabel>
        <FieldContent className="gap-3">
          <Textarea
            className="min-h-28"
            id="semantic-screening-rules"
            maxLength={SCREENING_TEXTAREA_MAX_LENGTH}
            onChange={(event) => setSemanticRules(event.target.value)}
            placeholder="每行一个要求，例如：有复杂项目从 0 到 1 搭建经验"
            value={joinRuleLines(semanticRules.map((rule) => rule.requirement))}
          />
          <SearchableSelect
            disabled={semanticRules.length === 0}
            onChange={(value) =>
              patchPolicy({
                rules: policy.rules.map((rule) =>
                  rule.type === "semantic"
                    ? { ...rule, severity: (value ?? "warning") as ResumeScreeningRuleSeverity }
                    : rule,
                ),
              })
            }
            options={SCREENING_SEVERITY_OPTIONS}
            placeholder="需核实"
            value={semanticSeverity}
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  );
}

// oxlint-disable-next-line complexity -- Dialog hosts tabs, queries, validation, and form submission together.
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
  const resolvedInitialValues = useMemo(() => {
    if (record) {
      return toDepartmentScopedFormValues(record, interviewers);
    }
    if (initialDraft) {
      return initialDraft;
    }
    return emptyJobDescriptionFormValues();
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
        throw new Error(payload?.error ?? "加载关联面试表单失败");
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
        throw new Error(payload?.error ?? "加载关联面试题失败");
      }
      return payload.records;
    },
    queryKey: ["job-description-linked-interview-questions", slug, record?.id],
  });

  const form = useForm({
    defaultValues: resolvedInitialValues,
    onSubmit: async ({ value }) => {
      const body = toSubmitBody(value);

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
        "recruitmentStatus",
        "controlCategory",
        "jobSeries",
        "jobLevel",
        "serviceUnit",
        "headcount",
        "onboardedCount",
        "gapCount",
        "offeredPendingOnboardCount",
        "requestedDate",
        "expectedOnboardDate",
        "priority",
        "requester",
        "resumeContact",
        "workLocation",
        "sourceSheet",
        "notes",
        "allowCrossDepartmentInterviewers",
        "interviewerIds",
        "description",
        "prompt",
        "salaryCurrency",
        "salaryMaxAmount",
        "salaryMinAmount",
      ];
      const hasBasicError = basicFields.some((key) => (meta[key]?.errors?.length ?? 0) > 0);
      const hasScreeningError = (meta.resumeScreeningPolicy?.errors?.length ?? 0) > 0;
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

  const missingRefs = departments.length === 0 || interviewers.length === 0;

  async function handleGenerateCode() {
    setIsGeneratingCode(true);
    try {
      const response = await rpc.api.w[":slug"].studio["job-descriptions"]["generate-code"].$post({
        param: { slug },
      });
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.code) {
        toast.error(payload?.error ?? "生成岗位编码失败");
        return;
      }
      form.setFieldValue("code", payload.code);
    } finally {
      setIsGeneratingCode(false);
    }
  }

  async function handleGenerateScreeningPolicy() {
    const { values } = form.store.state;
    if (!values.prompt.trim()) {
      toast.error("请先填写岗位 Prompt");
      return;
    }
    setIsGeneratingScreeningPolicy(true);
    try {
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
    } finally {
      setIsGeneratingScreeningPolicy(false);
    }
  }

  return (
    <Tabs onValueChange={(value) => setActiveTab(value as JobDescriptionFormTab)} value={activeTab}>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? "编辑在招岗位" : "新建在招岗位"}
        description="为在招岗位指定部门和面试官，prompt 在面试时会传给语音 agent。"
        size="xl"
        headerExtra={
          <TabsList className="mt-2">
            <TabsTrigger value="basic">基本信息</TabsTrigger>
            <TabsTrigger value="screening">筛选规则</TabsTrigger>
            {isEdit ? <TabsTrigger value="interview-questions">面试题</TabsTrigger> : null}
            {isEdit ? <TabsTrigger value="forms">面试表单</TabsTrigger> : null}
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
              {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
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
              <FieldGroup className="mt-4 gap-5">
                <div className="grid gap-5 md:grid-cols-2">
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
                          <FieldLabel htmlFor={field.name}>岗位编码</FieldLabel>
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

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-3">
                    <form.Field name="recruitmentStatus">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>招聘状态</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：招聘中"
                                value={field.state.value ?? ""}
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>优先级</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={80}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：P0（紧急/高）"
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>岗位管控分类</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：C类-正常招聘"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-3">
                    <form.Field name="jobSeries">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>序列</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>职级</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={80}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：P3"
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>服务单位</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：SETV"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-4">
                    <form.Field name="headcount">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>HC</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                inputMode="numeric"
                                min={0}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalIntegerInput(event.target.value))
                                }
                                placeholder="如：1"
                                step={1}
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>已到岗</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                inputMode="numeric"
                                min={0}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalIntegerInput(event.target.value))
                                }
                                placeholder="如：0"
                                step={1}
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>缺口</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                inputMode="numeric"
                                min={0}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalIntegerInput(event.target.value))
                                }
                                placeholder="如：1"
                                step={1}
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>Offer 待入职</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                inputMode="numeric"
                                min={0}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalIntegerInput(event.target.value))
                                }
                                placeholder="如：0"
                                step={1}
                                type="number"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-2">
                    <form.Field name="requestedDate">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <DateOnlyPickerField
                            errors={errors}
                            id={field.name}
                            invalid={hasFieldErrors(field.state.meta.errors)}
                            label="提需日期"
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            value={field.state.value}
                          />
                        );
                      }}
                    </form.Field>

                    <form.Field name="expectedOnboardDate">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <DateOnlyPickerField
                            errors={errors}
                            id={field.name}
                            invalid={hasFieldErrors(field.state.meta.errors)}
                            label="期望到岗日期"
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            value={field.state.value}
                          />
                        );
                      }}
                    </form.Field>
                  </div>

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-2">
                    <form.Field name="requester">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>需求发起人</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：马姬@maji_jj321"
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>简历对接人</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：小馒@atw0758"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-2">
                    <form.Field name="workLocation">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>工作地点</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：台湾"
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
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>来源表格</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                maxLength={120}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalTextInput(event.target.value))
                                }
                                placeholder="如：万帧公司"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>

                  <form.Field name="notes">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field
                          className="md:col-span-2"
                          data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                        >
                          <FieldLabel htmlFor={field.name}>备注说明</FieldLabel>
                          <FieldContent className="gap-2">
                            <Textarea
                              aria-invalid={!!errors?.length}
                              className="min-h-20"
                              id={field.name}
                              maxLength={2000}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(parseOptionalTextInput(event.target.value))
                              }
                              placeholder="非远程岗位可备注说明工作地点、补充招聘要求等"
                              value={field.state.value ?? ""}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

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

                  <form.Field name="interviewerIds">
                    {(field) => {
                      const errors = toFieldErrors(field.state.meta.errors);
                      return (
                        <Field
                          className="md:col-span-2"
                          data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                        >
                          <FieldLabel>
                            面试官 <span className="text-destructive">*</span>
                          </FieldLabel>
                          <FieldContent className="gap-2">
                            <SearchableMultiSelect
                              emptyMessage="没有匹配的面试官"
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
                              placeholder="选择面试官…"
                              searchPlaceholder="搜索面试官…"
                              selectedFormat={(count) => `已选 ${count} 位面试官`}
                              selectedPreviewLimit={3}
                              value={field.state.value}
                            />
                            <FieldError errors={errors} />
                          </FieldContent>
                        </Field>
                      );
                    }}
                  </form.Field>

                  <div className="grid gap-5 md:col-span-2 md:grid-cols-3">
                    <form.Field name="salaryMinAmount">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>薪资下限</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                inputMode="numeric"
                                min={0}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalIntegerInput(event.target.value))
                                }
                                placeholder="如：40000"
                                step={1}
                                type="number"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>

                    <form.Field name="salaryMaxAmount">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>薪资上限</FieldLabel>
                            <FieldContent className="gap-2">
                              <Input
                                aria-invalid={!!errors?.length}
                                id={field.name}
                                inputMode="numeric"
                                min={0}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(parseOptionalIntegerInput(event.target.value))
                                }
                                placeholder="如：50000"
                                step={1}
                                type="number"
                                value={field.state.value ?? ""}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>

                    <form.Field name="salaryCurrency">
                      {(field) => {
                        const errors = toFieldErrors(field.state.meta.errors);
                        return (
                          <Field
                            data-invalid={hasFieldErrors(field.state.meta.errors) || undefined}
                          >
                            <FieldLabel htmlFor={field.name}>薪资币种</FieldLabel>
                            <FieldContent className="gap-2">
                              <SearchableSelect
                                clearable
                                emptyMessage="没有匹配的币种"
                                id={field.name}
                                invalid={!!errors?.length}
                                onChange={(value) => field.handleChange(value)}
                                options={[...SALARY_CURRENCY_OPTIONS]}
                                placeholder="选择币种"
                                searchPlaceholder="搜索币种…"
                                value={field.state.value ?? null}
                              />
                              <FieldError errors={errors} />
                            </FieldContent>
                          </Field>
                        );
                      }}
                    </form.Field>
                  </div>
                </div>

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
                          岗位 Prompt <span className="text-destructive">*</span>
                        </FieldLabel>
                        <FieldContent className="gap-2">
                          <MarkdownEditor
                            aria-invalid={!!errors?.length}
                            id={field.name}
                            maxLength={PROMPT_MAX_LENGTH}
                            onBlur={field.handleBlur}
                            onChange={field.handleChange}
                            placeholder="岗位关键职责、技术栈要求、期望的考察维度……"
                            value={field.state.value}
                          />
                          <FieldError errors={errors} />
                        </FieldContent>
                      </Field>
                    );
                  }}
                </form.Field>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="screening">
              <form.Field name="resumeScreeningPolicy">
                {(field) => (
                  <ResumeScreeningPolicyFields
                    isGenerating={isGeneratingScreeningPolicy}
                    onChange={field.handleChange}
                    onGenerateFromJobDescription={handleGenerateScreeningPolicy}
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

function LinkedFormsList({
  isLoading,
  jobDescriptionId,
  templates,
}: {
  isLoading: boolean;
  jobDescriptionId: string;
  templates: CandidateFormTemplateListRecord[];
}) {
  const slug = useWorkspaceSlug();
  const newTemplateHref = `/w/${slug}/studio/forms?jobDescriptionId=${encodeURIComponent(jobDescriptionId)}`;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">岗位关联的面试表单</p>
          <p className="mt-1 text-muted-foreground text-xs">
            候选人进入面试前需要填写下列表单；全局面试表单在「面试表单」菜单中维护。
          </p>
        </div>
        <Button
          nativeButton={false}
          render={
            <a href={newTemplateHref} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" />
              管理表单
            </a>
          }
          size="sm"
          variant="outline"
        />
      </div>

      {isLoading ? (
        <Card className="gap-0 rounded-xl border-dashed py-0">
          <CardContent className="bg-muted/20 px-4 py-6 text-center text-muted-foreground text-sm">
            正在加载关联表单…
          </CardContent>
        </Card>
      ) : null}
      {!isLoading && templates.length === 0 ? (
        <Card className="gap-0 rounded-xl border-dashed py-0">
          <CardContent className="bg-muted/20 px-4 py-6 text-center text-muted-foreground text-sm">
            暂无该岗位专属的面试表单。
          </CardContent>
        </Card>
      ) : null}
      {!isLoading && templates.length > 0 ? (
        <div className="flex flex-col gap-2">
          {templates.map((template) => (
            <Card className="gap-0 rounded-xl py-0" key={template.id}>
              <CardContent className="p-0">
                <a
                  className="flex items-start justify-between gap-3 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  href={`/w/${slug}/studio/forms?templateId=${template.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <ClipboardListIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{template.title}</p>
                      {template.description ? (
                        <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
                          {template.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-muted-foreground text-xs">
                        {template.questionCount} 题 · {template.submissionCount} 份答复
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">岗位专属</Badge>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LinkedInterviewQuestionTemplatesList({
  isLoading,
  jobDescriptionId,
  templates,
}: {
  isLoading: boolean;
  jobDescriptionId: string;
  templates: InterviewQuestionTemplateListRecord[];
}) {
  const slug = useWorkspaceSlug();
  const newTemplateHref = `/w/${slug}/studio/interview-questions?jobDescriptionId=${encodeURIComponent(jobDescriptionId)}`;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">岗位关联的面试题</p>
          <p className="mt-1 text-muted-foreground text-xs">
            面试创建时会自动绑定到下列面试题的最新版本；全局面试题在「面试题」菜单中维护。
          </p>
        </div>
        <Button
          nativeButton={false}
          render={
            <a href={newTemplateHref} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" />
              管理模版
            </a>
          }
          size="sm"
          variant="outline"
        />
      </div>

      {isLoading ? (
        <Card className="gap-0 rounded-xl border-dashed py-0">
          <CardContent className="bg-muted/20 px-4 py-6 text-center text-muted-foreground text-sm">
            正在加载关联模版…
          </CardContent>
        </Card>
      ) : null}
      {!isLoading && templates.length === 0 ? (
        <Card className="gap-0 rounded-xl border-dashed py-0">
          <CardContent className="bg-muted/20 px-4 py-6 text-center text-muted-foreground text-sm">
            暂无该岗位专属的面试题。
          </CardContent>
        </Card>
      ) : null}
      {!isLoading && templates.length > 0 ? (
        <div className="flex flex-col gap-2">
          {templates.map((template) => (
            <Card className="gap-0 rounded-xl py-0" key={template.id}>
              <CardContent className="p-0">
                <a
                  className="flex items-start justify-between gap-3 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  href={`/w/${slug}/studio/interview-questions?templateId=${template.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <ListChecksIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{template.title}</p>
                      {template.description ? (
                        <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
                          {template.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-muted-foreground text-xs">
                        {template.questionCount} 题 · {template.bindingCount} 个面试已绑定
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">岗位专属</Badge>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
