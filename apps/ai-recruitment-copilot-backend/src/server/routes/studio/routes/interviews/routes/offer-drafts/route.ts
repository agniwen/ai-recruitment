import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { getObjectStream } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { studioInterview } from "@arc/db-schema/schema";
import { offerDraftInputSchema, offerResponseInputSchema } from "@arc/db-schema/studio-interviews";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { requireSscCandidateAccess } from "@arc/ai-recruitment-copilot-backend/server/middlewares/ssc-access";
import {
  getHumanInterviewOfferReadinessError,
  loadHumanInterviewRoundReadiness,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds";
import {
  cancelOfferDraft,
  createOfferDraft,
  deleteOfferDraft,
  editOfferDraft,
  listOfferDrafts,
  loadCurrentOfferSscState,
  loadOfferApprovalAttachment,
  maybeAdvanceToOffer,
  OfferDraftError,
  respondOfferDraft,
  sendOfferDraft,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { recordCandidateActivity } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-activity";
import { notifyCandidateStageChange } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-stage-notification";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { isPreviewImage } from "./utils";
import { offerSscRouter } from "./routes/ssc/route";

const createOfferInputSchema = offerDraftInputSchema.extend({
  sendImmediately: z.boolean().optional(),
});

async function createOfferVersion({
  actorId,
  actorRole,
  input,
  organizationId,
  recordId,
}: {
  actorId: string | null;
  actorRole: string | null;
  input: z.infer<typeof createOfferInputSchema>;
  organizationId: string;
  recordId: string;
}): Promise<{ created: OfferDraftRecord } | { error: string; status: 400 | 404 }> {
  if (input.sendImmediately) {
    return { error: "新建 Offer 必须先完成 SSC 确认，不能立即发送。", status: 400 };
  }
  const [candidate] = await db
    .select({
      id: studioInterview.id,
      outcome: studioInterview.outcome,
      pipelineStage: studioInterview.pipelineStage,
    })
    .from(studioInterview)
    .where(
      and(eq(studioInterview.id, recordId), eq(studioInterview.organizationId, organizationId)),
    )
    .limit(1);
  if (!candidate) {
    return { error: "候选人记录不存在。", status: 404 };
  }
  if (candidate.pipelineStage === "closed") {
    return { error: "已结案的候选人请先重新激活。", status: 400 };
  }
  if (candidate.pipelineStage !== "human_interview" && candidate.pipelineStage !== "offer") {
    return { error: "候选人需先进入真人复面阶段，才能创建 Offer。", status: 400 };
  }
  if (candidate.pipelineStage === "human_interview") {
    const readiness = await loadHumanInterviewRoundReadiness(recordId, organizationId);
    const readinessError = getHumanInterviewOfferReadinessError(readiness);
    if (readinessError) {
      return { error: readinessError, status: 400 };
    }
  }

  const { sendImmediately, ...draftInput } = input;
  let created: OfferDraftRecord;
  try {
    created = await createOfferDraft({
      actorId,
      actorRole,
      input: draftInput,
      interviewRecordId: recordId,
      organizationId,
      sendImmediately,
    });
  } catch (error) {
    if (error instanceof OfferDraftError && (error.status === 400 || error.status === 404)) {
      return { error: error.message, status: error.status };
    }
    throw error;
  }
  const stageChanged = await maybeAdvanceToOffer(recordId, organizationId);
  if (stageChanged) {
    await notifyCandidateStageChange({
      candidateId: recordId,
      fromOutcome: candidate.outcome,
      fromStage: candidate.pipelineStage,
      organizationId,
      toOutcome: "in_pipeline",
      toStage: "offer",
    });
  }
  await recordCandidateActivity({
    action: "offer_draft_created",
    detail: {
      draftId: created.id,
      position: created.position,
      sentImmediately: Boolean(sendImmediately),
      version: created.version,
    },
    interviewRecordId: recordId,
    operatorId: actorId,
    operatorRole: actorRole,
    organizationId,
  });
  invalidateStudioInterviewCaches(organizationId);
  return { created };
}

export const offerDraftsRouter = factory
  .createApp()
  .use("*", requireSscCandidateAccess())
  .get("/", requirePermission("offer", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const recordId = c.req.param("id");
    if (!recordId) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    const drafts = await listOfferDrafts(recordId, activeOrg.id);
    return c.json(drafts, 200);
  })
  .get("/ssc/current", requirePermission("offer", "read"), async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const interviewRecordId = c.req.param("id");
    if (!interviewRecordId) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    try {
      return c.json(
        await loadCurrentOfferSscState({
          actorUserId: user.id,
          interviewRecordId,
          organizationId: activeOrg.id,
        }),
        200,
      );
    } catch (error) {
      if (error instanceof OfferDraftError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  })
  .post(
    "/",
    requirePermission("offer", "create"),
    zValidator("json", createOfferInputSchema, jsonValidatorError("Offer 参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const recordId = c.req.param("id");
      if (!recordId) {
        return c.json({ error: "候选人记录不存在。" }, 404);
      }

      const result = await createOfferVersion({
        actorId: c.var.user?.id ?? null,
        actorRole: c.var.member?.role ?? null,
        input: c.req.valid("json"),
        organizationId: activeOrg.id,
        recordId,
      });
      return "error" in result
        ? c.json({ error: result.error }, result.status)
        : c.json(result.created, 200);
    },
  )
  .post("/with-attachment", requirePermission("offer", "create"), (c) =>
    c.json(
      { error: "ODC 审核附件功能已移除，请使用普通 Offer 表单；审批截图可在 SSC 完成确认时选填。" },
      410,
    ),
  )
  .get("/:draftId/approval-attachment", requirePermission("offer", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const recordId = c.req.param("id");
    if (!recordId) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    const attachment = await loadOfferApprovalAttachment(
      c.req.param("draftId"),
      recordId,
      activeOrg.id,
    );
    if (!attachment) {
      return c.json({ error: "附件不存在。" }, 404);
    }
    const object = await getObjectStream(attachment.storageKey);
    if (!object) {
      return c.json({ error: "附件不存在。" }, 404);
    }
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${isPreviewImage(attachment.mediaType) ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "Content-Type": attachment.mediaType,
        "X-Content-Type-Options": "nosniff",
        ...(object.contentLength !== undefined && {
          "Content-Length": String(object.contentLength),
        }),
      },
    });
  })
  .delete("/:draftId/approval-attachment", requirePermission("offer", "update"), (c) =>
    c.json({ error: "ODC 审核附件功能已移除，历史附件保留。" }, 410),
  )
  .patch("/:draftId/with-attachment", requirePermission("offer", "update"), (c) =>
    c.json({ error: "ODC 审核附件功能已移除，请使用普通 Offer 表单。" }, 410),
  )
  .patch(
    "/:draftId",
    requirePermission("offer", "update"),
    zValidator("json", offerDraftInputSchema.partial(), jsonValidatorError("Offer 参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const draftId = c.req.param("draftId");
      const input = c.req.valid("json");
      try {
        const updated = await editOfferDraft({ draftId, input, organizationId: activeOrg.id });
        await recordCandidateActivity({
          action: "offer_draft_updated",
          detail: {
            draftId: updated.id,
            position: updated.position,
            version: updated.version,
          },
          interviewRecordId: updated.interviewRecordId,
          operatorId: c.var.user?.id ?? null,
          operatorRole: c.var.member?.role ?? null,
          organizationId: activeOrg.id,
        });
        invalidateStudioInterviewCaches(activeOrg.id);
        return c.json(updated, 200);
      } catch (error) {
        if (error instanceof OfferDraftError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    },
  )
  .route("/:draftId/ssc", offerSscRouter)
  .post("/:draftId/send", requirePermission("offer", "update"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const draftId = c.req.param("draftId");
    try {
      const updated = await sendOfferDraft(draftId, activeOrg.id, {
        id: c.var.user?.id ?? null,
        role: c.var.member?.role ?? null,
      });
      await recordCandidateActivity({
        action: "offer_draft_sent",
        detail: {
          draftId: updated.id,
          position: updated.position,
          version: updated.version,
        },
        interviewRecordId: updated.interviewRecordId,
        operatorId: c.var.user?.id ?? null,
        operatorRole: c.var.member?.role ?? null,
        organizationId: activeOrg.id,
      });
      invalidateStudioInterviewCaches(activeOrg.id);
      return c.json(updated, 200);
    } catch (error) {
      if (error instanceof OfferDraftError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  })
  .post(
    "/:draftId/respond",
    requirePermission("offer", "update"),
    zValidator("json", offerResponseInputSchema, jsonValidatorError("响应参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const draftId = c.req.param("draftId");
      const { response, candidateCounter } = c.req.valid("json");
      try {
        const updated = await respondOfferDraft({
          candidateCounter,
          draftId,
          organizationId: activeOrg.id,
          response,
        });
        await recordCandidateActivity({
          action: "offer_draft_responded",
          detail: { draftId: updated.id, response, version: updated.version },
          interviewRecordId: updated.interviewRecordId,
          operatorId: c.var.user?.id ?? null,
          operatorRole: c.var.member?.role ?? null,
          organizationId: activeOrg.id,
        });
        invalidateStudioInterviewCaches(activeOrg.id);
        return c.json(updated, 200);
      } catch (error) {
        if (error instanceof OfferDraftError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    },
  )
  .delete("/:draftId", requirePermission("offer", "delete"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const draftId = c.req.param("draftId");
    try {
      const { draft: deleted, previousStatus } = await deleteOfferDraft(draftId, activeOrg.id);
      await recordCandidateActivity({
        action: "offer_draft_deleted",
        detail: {
          draftId: deleted.id,
          position: deleted.position,
          previousStatus,
          version: deleted.version,
        },
        interviewRecordId: deleted.interviewRecordId,
        operatorId: c.var.user?.id ?? null,
        operatorRole: c.var.member?.role ?? null,
        organizationId: activeOrg.id,
      });
      invalidateStudioInterviewCaches(activeOrg.id);
      return c.json({ success: true }, 200);
    } catch (error) {
      if (error instanceof OfferDraftError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  })
  .post("/:draftId/cancel", requirePermission("offer", "delete"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const draftId = c.req.param("draftId");
    try {
      const updated = await cancelOfferDraft(draftId, activeOrg.id);
      await recordCandidateActivity({
        action: "offer_draft_cancelled",
        detail: {
          draftId: updated.id,
          position: updated.position,
          version: updated.version,
        },
        interviewRecordId: updated.interviewRecordId,
        operatorId: c.var.user?.id ?? null,
        operatorRole: c.var.member?.role ?? null,
        organizationId: activeOrg.id,
      });
      invalidateStudioInterviewCaches(activeOrg.id);
      return c.json(updated, 200);
    } catch (error) {
      if (error instanceof OfferDraftError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });
