import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { deleteObject, getObjectStream } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { studioInterview } from "@arc/db-schema/schema";
import { offerDraftInputSchema, offerResponseInputSchema } from "@arc/db-schema/studio-interviews";
import { MAX_OFFER_APPROVAL_ATTACHMENT_BYTES } from "@arc/shared/studio-pipeline-stages";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  getHumanInterviewOfferReadinessError,
  loadHumanInterviewRoundReadiness,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds";
import {
  cancelOfferDraft,
  createOfferDraft,
  deleteOfferDraft,
  editOfferDraft,
  editOfferDraftWithAttachment,
  listOfferDrafts,
  loadDraftById,
  loadOfferApprovalAttachment,
  maybeAdvanceToOffer,
  OfferDraftError,
  removeOfferApprovalAttachment,
  respondOfferDraft,
  sendOfferDraft,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { recordCandidateActivity } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-activity";
import { notifyCandidateStageChange } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/utils/candidate-stage-notification";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import {
  isPreviewImage,
  storeOfferApprovalAttachment,
  validateOfferApprovalAttachment,
} from "./utils";

const createOfferInputSchema = offerDraftInputSchema.extend({
  sendImmediately: z.boolean().optional(),
});

async function createOfferVersion({
  actorId,
  actorRole,
  attachmentFile,
  input,
  organizationId,
  recordId,
}: {
  actorId: string | null;
  actorRole: string | null;
  attachmentFile?: File;
  input: z.infer<typeof createOfferInputSchema>;
  organizationId: string;
  recordId: string;
}): Promise<{ created: OfferDraftRecord } | { error: string; status: 400 | 404 }> {
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
  const approvalAttachment = attachmentFile
    ? await storeOfferApprovalAttachment(attachmentFile)
    : null;
  let created: OfferDraftRecord;
  try {
    created = await createOfferDraft({
      actorId,
      actorRole,
      approvalAttachment,
      input: draftInput,
      interviewRecordId: recordId,
      organizationId,
      sendImmediately,
    });
  } catch (error) {
    if (approvalAttachment) {
      try {
        await deleteObject(approvalAttachment.storageKey);
      } catch (cleanupError) {
        console.error("Failed to clean up unsaved Offer approval attachment", cleanupError);
      }
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
  .post("/with-attachment", requirePermission("offer", "create"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const recordId = c.req.param("id");
    if (!recordId) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    const form = await c.req.formData();
    const file = form.get("file");
    const inputText = form.get("offer");
    if (!(file instanceof File) || typeof inputText !== "string") {
      return c.json({ error: "请提供 Offer 内容和附件。" }, 400);
    }
    const fileError = validateOfferApprovalAttachment(file);
    if (fileError) {
      return c.json(
        { error: fileError },
        file.size > MAX_OFFER_APPROVAL_ATTACHMENT_BYTES ? 413 : 400,
      );
    }
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(inputText);
    } catch {
      return c.json({ error: "Offer 参数无效。" }, 400);
    }
    const input = createOfferInputSchema.safeParse(parsedInput);
    if (!input.success) {
      return c.json({ error: "Offer 参数无效。" }, 400);
    }
    const result = await createOfferVersion({
      actorId: c.var.user?.id ?? null,
      actorRole: c.var.member?.role ?? null,
      attachmentFile: file,
      input: input.data,
      organizationId: activeOrg.id,
      recordId,
    });
    return "error" in result
      ? c.json({ error: result.error }, result.status)
      : c.json(result.created, 200);
  })
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
  .delete("/:draftId/approval-attachment", requirePermission("offer", "update"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const recordId = c.req.param("id");
    if (!recordId) {
      return c.json({ error: "候选人记录不存在。" }, 404);
    }
    const draftId = c.req.param("draftId");
    const removed = await removeOfferApprovalAttachment(draftId, recordId, activeOrg.id);
    if (!removed) {
      return c.json({ error: "附件不存在。" }, 404);
    }
    await recordCandidateActivity({
      action: "offer_draft_updated",
      detail: { approvalAttachmentRemoved: true, draftId, filename: removed.filename },
      interviewRecordId: recordId,
      operatorId: c.var.user?.id ?? null,
      operatorRole: c.var.member?.role ?? null,
      organizationId: activeOrg.id,
    });
    invalidateStudioInterviewCaches(activeOrg.id);
    try {
      await deleteObject(removed.storageKey);
    } catch (error) {
      console.error("Failed to delete Offer approval attachment object", error);
    }
    return c.json({ success: true }, 200);
  })
  // oxlint-disable-next-line complexity -- Attachment replacement coordinates authorization, validation, transaction rollback and storage cleanup.
  .patch("/:draftId/with-attachment", requirePermission("offer", "update"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const recordId = c.req.param("id");
    const draftId = c.req.param("draftId");
    const existing = await loadDraftById(draftId, activeOrg.id);
    if (!existing || existing.interviewRecordId !== recordId) {
      return c.json({ error: "Offer 草稿不存在" }, 404);
    }
    const form = await c.req.formData();
    const file = form.get("file");
    const removeAttachment = form.get("removeAttachment") === "true";
    const inputText = form.get("offer");
    if (
      typeof inputText !== "string" ||
      (file !== null && !(file instanceof File)) ||
      (file !== null && removeAttachment) ||
      (file === null && !removeAttachment)
    ) {
      return c.json({ error: "附件修改参数无效。" }, 400);
    }
    if (file) {
      const fileError = validateOfferApprovalAttachment(file);
      if (fileError) {
        return c.json(
          { error: fileError },
          file.size > MAX_OFFER_APPROVAL_ATTACHMENT_BYTES ? 413 : 400,
        );
      }
    }
    let parsedInput: unknown;
    try {
      parsedInput = JSON.parse(inputText);
    } catch {
      return c.json({ error: "Offer 参数无效。" }, 400);
    }
    const input = offerDraftInputSchema.safeParse(parsedInput);
    if (!input.success) {
      return c.json({ error: "Offer 参数无效。" }, 400);
    }
    const approvalAttachment = file ? await storeOfferApprovalAttachment(file) : null;
    let result: Awaited<ReturnType<typeof editOfferDraftWithAttachment>>;
    try {
      result = await editOfferDraftWithAttachment({
        approvalAttachment,
        draftId,
        input: input.data,
        organizationId: activeOrg.id,
      });
    } catch (error) {
      if (approvalAttachment) {
        try {
          await deleteObject(approvalAttachment.storageKey);
        } catch (cleanupError) {
          console.error("Failed to clean up unsaved Offer approval attachment", cleanupError);
        }
      }
      if (error instanceof OfferDraftError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
    const { previousAttachment, updated } = result;
    await recordCandidateActivity({
      action: "offer_draft_updated",
      detail: { draftId: updated.id, position: updated.position, version: updated.version },
      interviewRecordId: updated.interviewRecordId,
      operatorId: c.var.user?.id ?? null,
      operatorRole: c.var.member?.role ?? null,
      organizationId: activeOrg.id,
    });
    invalidateStudioInterviewCaches(activeOrg.id);
    if (previousAttachment) {
      try {
        await deleteObject(previousAttachment.storageKey);
      } catch (error) {
        console.error("Failed to delete replaced Offer approval attachment object", error);
      }
    }
    return c.json(updated, 200);
  })
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
