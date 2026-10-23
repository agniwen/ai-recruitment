import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { resolveResumeVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/resume-visibility";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { isJobDescriptionInactive } from "@arc/shared/job-descriptions";
import { isResumeReviewGenerationQueueConfigured } from "@arc/resume-parse-queue/resume-review-generation";
import { enqueueResumeSemanticIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue";
import { loadJobDescriptionById } from "../../../job-descriptions/dao";
import { loadResumeDetail } from "../../dao/resumes";
import {
  continueProtectedResume,
  ResumeProtectionContinuationError,
} from "../../dao/protection/continue";
import { enqueueResumeReviewGenerationForRecordBestEffort } from "../../utils/review-queue";

export const resumeProtectionContinueRouter = factory
  .createApp()
  .use(requirePermission("resumeLibrary", "create"))
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        confirmed: z.literal(true),
      }),
      jsonValidatorError("请确认继续推荐。"),
    ),
    async (c) => {
      const { activeOrg, user, member } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id) {
        return c.json({ error: "候选人记录不存在。" }, 404);
      }
      const scope = await resolveResumeVisibilityScope({
        currentRole: member?.role,
        organizationId: activeOrg.id,
        userId: user.id,
      });
      const record = await loadResumeDetail(id, activeOrg.id, scope);
      if (!record) {
        return c.json({ error: "候选人记录不存在。" }, 404);
      }
      if (!record.jobDescriptionId) {
        return c.json({ error: "该记录尚未关联岗位，请先关联岗位后继续推荐。" }, 400);
      }
      const job = await loadJobDescriptionById(activeOrg.id, record.jobDescriptionId, {
        actorUserId: user.id,
      });
      if (!job?.hiringUnitId || isJobDescriptionInactive(job)) {
        return c.json({ error: "原推荐岗位已失效或无权推荐，请先检查关联岗位。" }, 400);
      }
      if (!isResumeReviewGenerationQueueConfigured()) {
        return c.json({ error: "暂时无法开始分析，请稍后重试。" }, 503);
      }
      try {
        const result = await continueProtectedResume({
          jobDescriptionId: job.id,
          memberRole: member?.role,
          organizationId: activeOrg.id,
          recordId: id,
          userId: user.id,
        });
        const analysisQueued =
          !result.needsAnalysis ||
          (await enqueueResumeReviewGenerationForRecordBestEffort({
            jobDescriptionId: result.jobDescriptionId,
            organizationId: activeOrg.id,
            resumeRecordId: id,
            source: "resume_upload",
          }));
        if (result.needsAnalysis) {
          await enqueueResumeSemanticIndexJobBestEffort({
            organizationId: activeOrg.id,
            sourceId: id,
            sourceType: "studio_interview",
          });
        }
        invalidateStudioInterviewCaches(activeOrg.id);
        return c.json({ analysisQueued, status: "accepted" as const }, 200);
      } catch (error) {
        if (error instanceof ResumeProtectionContinuationError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    },
  );
