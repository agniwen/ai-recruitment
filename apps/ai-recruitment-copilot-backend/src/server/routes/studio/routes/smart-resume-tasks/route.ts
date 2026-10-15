import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import {
  createSmartResumeTaskSchema,
  smartResumeTaskDraftSchema,
} from "@arc/shared/smart-resume-upload";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { chatAttachment, resumeUploadBatchItem } from "@arc/db-schema/schema";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { adminMiddleware } from "@arc/ai-recruitment-copilot-backend/server/middlewares/admin";
import {
  enqueueResumeParseJobs,
  isResumeParseQueueConfigured,
} from "@arc/resume-parse-queue/resume-parse";
import { insertBatchWithItems } from "../resume-upload-batches/dao/batches";
import { validatePortfolioAttachments } from "../resumes/utils/portfolio-attachments";
import {
  listUnsubmittedSmartTasks,
  loadSmartTask,
  retrySmartTask,
  saveSmartTaskDraft,
  submitSmartTask,
} from "./dao";
import { loadEligibleSmartJobs } from "./utils/jobs";
import { smartResumeTaskItemsRouter } from "./routes/items/route";

export const smartResumeTasksRouter = factory
  .createApp()
  .use(adminMiddleware)
  .use(requirePermission("resumeLibrary", "create"))
  .use(requirePermission("resumeUploadBatch", "create"))
  .get("/", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ tasks: await listUnsubmittedSmartTasks(activeOrg.id, user.id) }, 200);
  })
  .post(
    "/",
    zValidator("json", createSmartResumeTaskSchema, jsonValidatorError("上传参数无效。")),
    async (c) => {
      const { activeOrg, user, member } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      if (!isResumeParseQueueConfigured()) {
        return c.json({ error: "后台处理队列尚未配置，请联系管理员。" }, 503);
      }
      const input = c.req.valid("json");
      let existing = await loadSmartTask(input.requestId, activeOrg.id, user.id);
      if (!existing) {
        const portfolioValidation = await Promise.all(
          input.files.map((file) =>
            validatePortfolioAttachments(file.portfolioAttachments ?? [], activeOrg.id, user.id),
          ),
        );
        if (!portfolioValidation.every(Boolean)) {
          return c.json({ error: "部分作品集未上传成功或无权访问，请重新添加。" }, 400);
        }
        const attachments = await db
          .select({
            contentHash: chatAttachment.contentHash,
            storageKey: chatAttachment.storageKey,
          })
          .from(chatAttachment)
          .where(
            and(
              eq(chatAttachment.organizationId, activeOrg.id),
              eq(chatAttachment.userId, user.id),
              inArray(
                chatAttachment.storageKey,
                input.files.map((file) => file.storageKey),
              ),
            ),
          );
        if (
          input.files.some(
            (file) =>
              !attachments.some(
                (attachment) =>
                  attachment.storageKey === file.storageKey &&
                  attachment.contentHash === file.contentHash,
              ),
          )
        ) {
          return c.json({ error: "部分文件未上传成功或无权访问，请重新选择。" }, 400);
        }
        try {
          await insertBatchWithItems({
            ...input,
            batchId: input.requestId,
            dedupPolicy: "create",
            jdMode: "none",
            jobDescriptionId: null,
            organizationId: activeOrg.id,
            resumePoolScope: "private",
            smartUpload: true,
            target: "resume_pool",
            userId: user.id,
            userRole: member?.role,
          });
        } catch (error) {
          existing = await loadSmartTask(input.requestId, activeOrg.id, user.id);
          if (!existing) {
            throw error;
          }
        }
      }
      const pending = await db
        .select({ itemId: resumeUploadBatchItem.id })
        .from(resumeUploadBatchItem)
        .where(
          and(
            eq(resumeUploadBatchItem.batchId, input.requestId),
            eq(resumeUploadBatchItem.status, "pending"),
          ),
        );
      try {
        if (pending.length) {
          await enqueueResumeParseJobs(
            pending.map(({ itemId }) => ({
              batchId: input.requestId,
              itemId,
              organizationId: activeOrg.id,
              userId: user.id,
            })),
          );
        }
      } catch {
        // The task is already durable; retry is available from the unsubmitted-task list.
        return c.json({ id: input.requestId, queued: false }, 201);
      }
      return c.json({ id: input.requestId, queued: true }, 201);
    },
  )
  .route("/:id/items", smartResumeTaskItemsRouter)
  .get("/:id", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const task = await loadSmartTask(c.req.param("id"), activeOrg.id, user.id);
    if (!task) {
      return c.json({ error: "任务不存在或无权访问。" }, 404);
    }
    const jobs = await loadEligibleSmartJobs(activeOrg.id, user.id);
    const allowed = new Set(jobs.map((entry) => entry.job.id));
    return c.json(
      {
        jobs: jobs.map((entry) => entry.option),
        task: {
          ...task,
          items: task.items.map((item) => ({
            ...item,
            result: item.result
              ? {
                  ...item.result,
                  recommendations: item.result.recommendations.filter((rec) =>
                    allowed.has(rec.jobDescriptionId),
                  ),
                }
              : null,
            selectedJobIds: item.selectedJobIds.filter((id) => allowed.has(id)),
          })),
        },
      },
      200,
    );
  })
  .patch(
    "/:id",
    zValidator("json", smartResumeTaskDraftSchema, jsonValidatorError("任务参数无效。")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      try {
        await saveSmartTaskDraft(c.req.param("id"), activeOrg.id, user.id, c.req.valid("json"));
        return c.json({ saved: true }, 200);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "保存失败。" }, 400);
      }
    },
  )
  .post("/:id/submit", async (c) => {
    const { activeOrg, user, member } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      return c.json(
        await submitSmartTask(c.req.param("id"), activeOrg.id, user.id, member?.role),
        200,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "提交失败。" }, 400);
    }
  })
  .post("/:id/retry", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      return c.json(await retrySmartTask(c.req.param("id"), activeOrg.id, user.id), 200);
    } catch {
      return c.json({ error: "重新排队未完成，任务已保留，请稍后重试。" }, 503);
    }
  });
