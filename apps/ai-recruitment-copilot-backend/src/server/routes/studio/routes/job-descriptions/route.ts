import { zValidator } from "@hono/zod-validator";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { uniq } from "lodash-es";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  jobDescriptionHumanInterviewer,
  jobDescriptionInterviewer,
  member,
  studioInterview,
} from "@arc/db-schema/schema";
import {
  JOB_DESCRIPTION_TALENT_RECOMMENDATION_MAX_LIMIT,
  jobDescriptionFormSchema,
  jobDescriptionUpdateSchema,
} from "@arc/shared/job-descriptions";
import { computeResumeScreeningPolicyHash } from "@arc/shared/resume-screening";
import { validateJobDescriptionInterviewerDepartments } from "@arc/shared/job-description-interviewers";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { createInternalErrorResponse } from "@arc/ai-recruitment-copilot-backend/server/error-handler";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  listAllJobDescriptions,
  loadJobDescriptionById,
  queryPaginatedJobDescriptions,
  serializeJobDescription,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao";
import { loadDepartmentById } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { listAllInterviewers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviewers/dao";
import { cacheTags, safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import {
  deleteJobDescriptionSemanticIndexBestEffort,
  enqueueJobDescriptionIndexJobBestEffort,
} from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue";
import { googleSheetSyncRouter } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/routes/google-sheet-sync/route";
import { generateJobDescriptionFromPrompt } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/utils/ai-job-description-generate";
import { generateResumeScreeningPolicyFromJobDescription } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/utils/resume-screening-policy-generate";
import {
  buildJobDescriptionCodeCandidates,
  pickAvailableJobDescriptionCode,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/utils/job-description-code";
import { recommendCandidatesForJobDescription } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/utils/recommendations";
import { getGlobalConfig } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/global-config/dao";

const generateJobDescriptionBodySchema = z.object({
  departmentName: z.string().trim().max(120).optional(),
  jobName: z.string().trim().max(120).optional(),
  prompt: z.string().trim().min(1, "请填写 AI 填写指令").max(2000),
});

const generateResumeScreeningPolicyBodySchema = z.object({
  description: z.string().trim().max(500).optional(),
  name: z.string().trim().max(120).optional(),
  prompt: z.string().trim().min(1, "请先填写岗位 Prompt").max(10_000),
});

async function validateReferences(
  organizationId: string,
  departmentId: string,
  interviewerIds: string[],
  allowCrossDepartmentInterviewers: boolean,
  actorUserId: string | null | undefined,
) {
  const [departmentRow, selectableInterviewers] = await Promise.all([
    loadDepartmentById(departmentId, organizationId, { actorUserId }),
    interviewerIds.length > 0
      ? listAllInterviewers(organizationId, { actorUserId })
      : Promise.resolve([]),
  ]);
  const selectableInterviewerMap = new Map(selectableInterviewers.map((item) => [item.id, item]));
  const interviewerRows = interviewerIds
    .map((id) => selectableInterviewerMap.get(id))
    .filter((item): item is (typeof selectableInterviewers)[number] => item !== undefined);

  if (!departmentRow) {
    return { departmentHiringUnitId: null, error: "所选部门不存在。" as const };
  }
  if (interviewerRows.length !== interviewerIds.length) {
    return { departmentHiringUnitId: null, error: "存在无效的面试官，请刷新后重试。" as const };
  }
  return {
    departmentHiringUnitId: departmentRow.hiringUnitId,
    error: validateJobDescriptionInterviewerDepartments({
      allowCrossDepartmentInterviewers,
      departmentId,
      interviewers: interviewerRows,
    }),
  };
}

function dedupeInterviewerIds(ids: string[]): string[] {
  return uniq(ids.map((id) => id.trim()).filter(Boolean));
}

async function humanInterviewerIdsAreValid(
  organizationId: string,
  userIds: string[],
): Promise<boolean> {
  if (userIds.length === 0) {
    return true;
  }
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.isInterviewer, true),
        inArray(member.userId, userIds),
      ),
    );
  return rows.length === userIds.length;
}

function nullableText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isJobCodeConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { cause?: unknown; code?: unknown; constraint?: unknown };
  return (
    candidate.code === "23505" ||
    candidate.constraint === "job_description_org_code_uq" ||
    isJobCodeConflict(candidate.cause)
  );
}

function buildManualJobDescriptionRecord(args: {
  code: string;
  input: z.infer<typeof jobDescriptionFormSchema>;
  now: Date;
  organizationId: string;
  departmentHiringUnitId: string | null;
  createdBy: string | null;
  resumeScreeningPolicyHash: string;
}): typeof jobDescription.$inferSelect {
  const {
    code,
    input,
    now,
    organizationId,
    departmentHiringUnitId,
    createdBy,
    resumeScreeningPolicyHash,
  } = args;
  return {
    aiInterviewDisabled: input.aiInterviewDisabled,
    allowCrossDepartmentInterviewers: input.allowCrossDepartmentInterviewers,
    code,
    controlCategory: nullableText(input.controlCategory),
    createdAt: now,
    createdBy,
    creationSource: "manual",
    departmentId: input.departmentId,
    description: input.description?.trim() || null,
    expectedOnboardDate: nullableText(input.expectedOnboardDate),
    feishuChatBoundAt: null,
    feishuChatBoundBy: null,
    feishuChatId: null,
    gapCount: input.gapCount ?? null,
    googleSheetDeleted: null,
    headcount: input.headcount ?? null,
    hiringUnitId: departmentHiringUnitId,
    id: crypto.randomUUID(),
    jobLevel: nullableText(input.jobLevel),
    jobSeries: nullableText(input.jobSeries),
    name: input.name.trim(),
    notes: nullableText(input.notes),
    offeredPendingOnboardCount: input.offeredPendingOnboardCount ?? null,
    onboardedCount: input.onboardedCount ?? null,
    organizationId,
    // presetQuestions is deprecated — column kept with default [] for legacy
    // data; new rows always store an empty array.
    presetQuestions: [],
    priority: input.priority,
    prompt: input.prompt.trim(),
    recruitmentStatus: nullableText(input.recruitmentStatus),
    requestedDate: nullableText(input.requestedDate),
    requester: nullableText(input.requester),
    resumeContact: nullableText(input.resumeContact),
    resumeScreeningPolicy: input.resumeScreeningPolicy,
    resumeScreeningPolicyHash,
    resumeScreeningPolicyVersion: input.resumeScreeningPolicy.version,
    salaryCurrency: nullableText(input.salaryCurrency),
    salaryMaxAmount: input.salaryMaxAmount ?? null,
    salaryMinAmount: input.salaryMinAmount ?? null,
    salaryRangeRaw: nullableText(input.salaryRangeRaw),
    serviceUnit: nullableText(input.serviceUnit),
    sourceSheet: nullableText(input.sourceSheet),
    updatedAt: now,
    workEndTime: nullableText(input.workEndTime),
    workLocation: nullableText(input.workLocation),
    workStartTime: nullableText(input.workStartTime),
    workTimezone: nullableText(input.workTimezone),
  } satisfies typeof jobDescription.$inferSelect;
}

const jobDescriptionListQuerySchema = z.object({
  code: z.string().optional(),
  departmentId: z.string().optional(),
  googleSheetStatus: z.string().optional(),
  hiringUnitId: z.string().optional(),
  interviewerId: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  recruitmentStatus: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  sourceSheet: z.string().optional(),
});

const recommendationBodySchema = z.object({
  excludeAlreadyLinked: z.boolean().optional().default(true),
  limit: z
    .number()
    .int()
    .min(1)
    .max(JOB_DESCRIPTION_TALENT_RECOMMENDATION_MAX_LIMIT)
    .optional()
    .default(20),
});

export const jobDescriptionsRouter = factory
  .createApp()
  .post(
    "/ai-generate",
    requirePermission("jd", "update"),
    zValidator("json", generateJobDescriptionBodySchema, jsonValidatorError("请求参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }

      const body = c.req.valid("json");
      try {
        const result = await generateJobDescriptionFromPrompt({
          departmentName: body.departmentName ?? null,
          hrPrompt: body.prompt,
          jobName: body.jobName ?? null,
        });
        return c.json(result, 200);
      } catch (error) {
        return c.json(
          createInternalErrorResponse({
            context: { organizationId: activeOrg.id },
            error,
            operation: "job-description-ai-generate",
            publicMessage: "AI 生成失败。",
          }),
          500,
        );
      }
    },
  )
  .get(
    "/",
    requirePermission("jd", "read"),
    zValidator("query", jobDescriptionListQuerySchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const q = c.req.valid("query");
      const result = await queryPaginatedJobDescriptions(
        activeOrg.id,
        {
          actorUserId: c.var.user?.id,
          code: q.code,
          departmentId: q.departmentId,
          googleSheetStatus: q.googleSheetStatus,
          hiringUnitId: q.hiringUnitId,
          interviewerId: q.interviewerId,
          recruitmentStatus: q.recruitmentStatus,
          search: q.search,
          sourceSheet: q.sourceSheet,
        },
        {
          page: q.page,
          pageSize: q.pageSize,
          sortBy: q.sortBy,
          sortOrder: q.sortOrder,
        },
      );
      return c.json(result, 200);
    },
  )
  .get("/all", requirePermission("jd", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const records = await listAllJobDescriptions(activeOrg.id, { actorUserId: c.var.user?.id });
    return c.json({ records }, 200);
  })
  .post("/generate-code", requirePermission("jd", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const now = new Date();
    const globalConfig = await getGlobalConfig(activeOrg.id);
    const candidates = buildJobDescriptionCodeCandidates({
      createdAt: now,
      prefix: globalConfig.jobCodePrefix,
    });
    const usedRows = await db
      .select({ code: jobDescription.code })
      .from(jobDescription)
      .where(
        and(
          eq(jobDescription.organizationId, activeOrg.id),
          inArray(jobDescription.code, candidates),
        ),
      );
    const code = pickAvailableJobDescriptionCode(
      candidates,
      usedRows.map((row) => row.code),
    );
    if (!code) {
      return c.json({ error: "当前分钟岗位唯一编码已用尽，请稍后重试。" }, 409);
    }
    return c.json({ code }, 200);
  })
  .post(
    "/generate-screening-policy",
    requirePermission("jd", "update"),
    zValidator(
      "json",
      generateResumeScreeningPolicyBodySchema,
      jsonValidatorError("请求参数无效。"),
    ),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      try {
        const policy = await generateResumeScreeningPolicyFromJobDescription({
          description: input.description ?? null,
          name: input.name ?? null,
          prompt: input.prompt,
        });
        return c.json({ policy }, 200);
      } catch (error) {
        return c.json(
          createInternalErrorResponse({
            context: { organizationId: activeOrg.id },
            error,
            operation: "job-description-screening-policy-generate",
            publicMessage: "筛选规则生成失败。",
          }),
          500,
        );
      }
    },
  )
  .route("/sync-google-sheet", googleSheetSyncRouter)
  .post(
    "/",
    requirePermission("jd", "create"),
    zValidator("json", jobDescriptionFormSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const resumeScreeningPolicyHash = computeResumeScreeningPolicyHash(
        input.resumeScreeningPolicy,
      );
      const interviewerIds = dedupeInterviewerIds(input.interviewerIds);
      const humanInterviewerIds = dedupeInterviewerIds(input.humanInterviewerIds);
      const { departmentHiringUnitId, error: referenceError } = await validateReferences(
        activeOrg.id,
        input.departmentId,
        interviewerIds,
        input.allowCrossDepartmentInterviewers,
        c.var.user?.id,
      );
      if (referenceError) {
        return c.json({ error: referenceError }, 400);
      }
      if (!(await humanInterviewerIdsAreValid(activeOrg.id, humanInterviewerIds))) {
        return c.json({ error: "存在无效的真人面试官，请刷新后重试。" }, 400);
      }

      const now = new Date();
      const globalConfig = await getGlobalConfig(activeOrg.id);
      const codeCandidates = buildJobDescriptionCodeCandidates({
        createdAt: now,
        prefix: globalConfig.jobCodePrefix,
      });
      const preferredCodeCandidates = input.code
        ? [input.code, ...codeCandidates.filter((code) => code !== input.code)]
        : codeCandidates;

      for (const code of preferredCodeCandidates) {
        const record = buildManualJobDescriptionRecord({
          code,
          createdBy: c.var.user?.id ?? null,
          departmentHiringUnitId,
          input,
          now,
          organizationId: activeOrg.id,
          resumeScreeningPolicyHash,
        });

        try {
          await db.transaction(async (tx) => {
            await tx.insert(jobDescription).values(record);
            if (interviewerIds.length > 0) {
              await tx.insert(jobDescriptionInterviewer).values(
                interviewerIds.map((id) => ({
                  createdAt: now,
                  interviewerId: id,
                  jobDescriptionId: record.id,
                })),
              );
            }
            if (humanInterviewerIds.length > 0) {
              await tx.insert(jobDescriptionHumanInterviewer).values(
                humanInterviewerIds.map((userId) => ({
                  createdAt: now,
                  jobDescriptionId: record.id,
                  userId,
                })),
              );
            }
          });

          safeUpdateTag(`job-descriptions:${activeOrg.id}`);
          safeUpdateTag(`interviewers:${activeOrg.id}`);

          await enqueueJobDescriptionIndexJobBestEffort({
            jobDescriptionId: record.id,
            organizationId: activeOrg.id,
          });

          const created = await loadJobDescriptionById(activeOrg.id, record.id, {
            actorUserId: c.var.user?.id,
          });
          return c.json(
            created ?? serializeJobDescription(record, interviewerIds, humanInterviewerIds),
            201,
          );
        } catch (insertError) {
          if (!isJobCodeConflict(insertError)) {
            throw insertError;
          }
        }
      }

      return c.json({ error: "当前分钟岗位唯一编码已用尽，请稍后重试。" }, 409);
    },
  )
  .get("/:id", requirePermission("jd", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const record = await loadJobDescriptionById(activeOrg.id, id, {
      actorUserId: c.var.user?.id,
    });
    if (!record) {
      return c.json({ error: "在招岗位不存在。" }, 404);
    }
    return c.json(record, 200);
  })
  .post(
    "/:id/recommendations",
    requirePermission("jd", "read"),
    requirePermission("resumeLibrary", "read"),
    requirePermission("resumePool", "read"),
    zValidator("json", recommendationBodySchema, jsonValidatorError("请求参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      const record = await loadJobDescriptionById(activeOrg.id, id, {
        actorUserId: c.var.user?.id,
      });
      if (!record) {
        return c.json({ error: "在招岗位不存在。" }, 404);
      }
      const body = c.req.valid("json");
      try {
        const result = await recommendCandidatesForJobDescription({
          excludeAlreadyLinked: body.excludeAlreadyLinked,
          jobDescription: {
            departmentName: null,
            description: record.description,
            id: record.id,
            name: record.name,
            prompt: record.prompt,
          },
          limit: body.limit,
          organizationId: activeOrg.id,
        });
        return c.json(result, 200);
      } catch (error) {
        console.warn("[job-description-recommendations] failed", {
          error,
          id,
          organizationId: activeOrg.id,
        });
        return c.json({ error: "人才推荐失败，请稍后重试。" }, 500);
      }
    },
  )
  .patch(
    "/:id",
    requirePermission("jd", "update"),
    zValidator("json", jobDescriptionUpdateSchema, jsonValidatorError("表单校验失败。")),
    // oxlint-disable-next-line complexity -- update path validates references, interviewer links, and screening-policy versioning together.
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      const existing = await loadJobDescriptionById(activeOrg.id, id, {
        actorUserId: c.var.user?.id,
      });
      if (!existing) {
        return c.json({ error: "在招岗位不存在。" }, 404);
      }

      const input = c.req.valid("json");
      const nextPolicyHash = computeResumeScreeningPolicyHash(input.resumeScreeningPolicy);
      const existingPolicyHash =
        existing.resumeScreeningPolicyHash ??
        computeResumeScreeningPolicyHash(existing.resumeScreeningPolicy);
      const policyChanged = nextPolicyHash !== existingPolicyHash;
      const nextPolicyVersion = policyChanged
        ? existing.resumeScreeningPolicyVersion + 1
        : existing.resumeScreeningPolicyVersion;
      const interviewerIds = dedupeInterviewerIds(input.interviewerIds);
      const humanInterviewerIds = dedupeInterviewerIds(input.humanInterviewerIds);
      const { departmentHiringUnitId, error } = await validateReferences(
        activeOrg.id,
        input.departmentId,
        interviewerIds,
        input.allowCrossDepartmentInterviewers,
        c.var.user?.id,
      );
      if (error) {
        return c.json({ error }, 400);
      }
      if (!(await humanInterviewerIdsAreValid(activeOrg.id, humanInterviewerIds))) {
        return c.json({ error: "存在无效的真人面试官，请刷新后重试。" }, 400);
      }

      const now = new Date();
      // Google-synced jobs keep sheet-written 编制组织 until the next sheet sync.
      // Manual jobs refresh hiring unit from the selected department.
      const nextHiringUnitId =
        existing.creationSource === "google_sheets"
          ? existing.hiringUnitId
          : departmentHiringUnitId;
      const updateValues = {
        aiInterviewDisabled: input.aiInterviewDisabled,
        allowCrossDepartmentInterviewers: input.allowCrossDepartmentInterviewers,
        controlCategory: nullableText(input.controlCategory),
        departmentId: input.departmentId,
        description: input.description?.trim() || null,
        expectedOnboardDate: nullableText(input.expectedOnboardDate),
        gapCount: input.gapCount ?? null,
        headcount: input.headcount ?? null,
        hiringUnitId: nextHiringUnitId,
        ...(!existing.code && input.code ? { code: input.code } : {}),
        jobLevel: nullableText(input.jobLevel),
        jobSeries: nullableText(input.jobSeries),
        name: input.name.trim(),
        notes: nullableText(input.notes),
        offeredPendingOnboardCount: input.offeredPendingOnboardCount ?? null,
        onboardedCount: input.onboardedCount ?? null,
        priority: input.priority,
        prompt: input.prompt.trim(),
        recruitmentStatus: nullableText(input.recruitmentStatus),
        requestedDate: nullableText(input.requestedDate),
        requester: nullableText(input.requester),
        resumeContact: nullableText(input.resumeContact),
        resumeScreeningPolicy: {
          ...input.resumeScreeningPolicy,
          version: nextPolicyVersion,
        },
        resumeScreeningPolicyHash: nextPolicyHash,
        resumeScreeningPolicyVersion: nextPolicyVersion,
        salaryCurrency: nullableText(input.salaryCurrency),
        salaryMaxAmount: input.salaryMaxAmount ?? null,
        salaryMinAmount: input.salaryMinAmount ?? null,
        salaryRangeRaw: nullableText(input.salaryRangeRaw),
        serviceUnit: nullableText(input.serviceUnit),
        sourceSheet: nullableText(input.sourceSheet),
        updatedAt: now,
        workEndTime: nullableText(input.workEndTime),
        workLocation: nullableText(input.workLocation),
        workStartTime: nullableText(input.workStartTime),
        workTimezone: nullableText(input.workTimezone),
      };
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(jobDescription)
            .set(updateValues)
            .where(and(eq(jobDescription.id, id), eq(jobDescription.organizationId, activeOrg.id)));

          // Replace junction links atomically.
          await tx
            .delete(jobDescriptionInterviewer)
            .where(eq(jobDescriptionInterviewer.jobDescriptionId, id));
          if (interviewerIds.length > 0) {
            await tx.insert(jobDescriptionInterviewer).values(
              interviewerIds.map((interviewerId) => ({
                createdAt: now,
                interviewerId,
                jobDescriptionId: id,
              })),
            );
          }
          await tx
            .delete(jobDescriptionHumanInterviewer)
            .where(eq(jobDescriptionHumanInterviewer.jobDescriptionId, id));
          if (humanInterviewerIds.length > 0) {
            await tx.insert(jobDescriptionHumanInterviewer).values(
              humanInterviewerIds.map((userId) => ({
                createdAt: now,
                jobDescriptionId: id,
                userId,
              })),
            );
          }
        });
      } catch (updateError) {
        if (isJobCodeConflict(updateError)) {
          return c.json({ error: "岗位唯一编码已被占用，请重新生成。" }, 409);
        }
        throw updateError;
      }

      safeUpdateTag(`job-descriptions:${activeOrg.id}`);
      safeUpdateTag(`interviewers:${activeOrg.id}`);
      await enqueueJobDescriptionIndexJobBestEffort({
        jobDescriptionId: id,
        organizationId: activeOrg.id,
      });

      const updated = await loadJobDescriptionById(activeOrg.id, id, {
        actorUserId: c.var.user?.id,
      });
      return c.json(updated, 200);
    },
  )
  .delete("/:id", requirePermission("jd", "delete"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await loadJobDescriptionById(activeOrg.id, id, {
      actorUserId: c.var.user?.id,
    });
    if (!existing) {
      return c.json({ error: "在招岗位不存在。" }, 404);
    }

    // 有非归档候选人关联到该岗位时禁止删除：候选人是业务实体，外键的 SET NULL
    // 行为会让简历挂在"未知岗位"上，难以追溯，因此前置拦截。
    // Block delete when non-archived candidates still reference this JD —
    // SET NULL would orphan candidates onto an empty job-description column
    // and make follow-up triage hard. Force the user to deal with them first.
    const [resumeRow] = await db
      .select({ count: count() })
      .from(studioInterview)
      .where(
        and(eq(studioInterview.jobDescriptionId, id), ne(studioInterview.pipelineStage, "closed")),
      );
    const resumeCount = resumeRow?.count ?? 0;
    if (resumeCount > 0) {
      return c.json(
        {
          error: `当前有 ${resumeCount} 条简历关联到该在招岗位，无法删除；请先在候选人管理中调整或删除这些候选人。`,
        },
        409,
      );
    }

    // jobDescriptionInterviewer cascades on JD delete; studio_interview.job_description_id → SET NULL.
    await db
      .delete(jobDescription)
      .where(and(eq(jobDescription.id, id), eq(jobDescription.organizationId, activeOrg.id)));
    safeUpdateTag(`job-descriptions:${activeOrg.id}`);
    safeUpdateTag(cacheTags.studioInterviews(activeOrg.id));
    safeUpdateTag(`interviewers:${activeOrg.id}`);

    await deleteJobDescriptionSemanticIndexBestEffort({
      jobDescriptionId: id,
      organizationId: activeOrg.id,
    });

    return c.json({ success: true }, 200);
  });
