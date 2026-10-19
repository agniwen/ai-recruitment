import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getObjectStream } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import type { Env } from "@arc/ai-recruitment-copilot-backend/server/type";
import {
  completeOfferSscConfirmation,
  loadAuthorizedOfferSscContext,
  loadOfferSscCompletionAttachment,
  OfferDraftError,
  receiveOfferSscConfirmation,
} from "../../../../dao/offer-drafts";
import { completeOfferSscWithScreenshot } from "../../../../dao/offer-ssc-completion";
import { buildTelegramOfferLink } from "@arc/ai-recruitment-copilot-backend/server/routes/telegram/utils/offer-ssc-link";
import { MAX_SSC_COMPLETION_SCREENSHOT_BYTES } from "@arc/shared/studio-pipeline-stages";

const actionSchema = z.object({ revision: z.number().int().min(1) });
const completionSchema = actionSchema.extend({ internalApprovalConfirmed: z.literal(true) });
const completionFormSchema = z.object({
  internalApprovalConfirmed: z.literal("true"),
  revision: z.coerce.number().int().min(1),
});

function actionInput(c: Context<Env>, revision: number) {
  const { activeOrg, user } = c.var;
  const draftId = c.req.param("draftId");
  const interviewRecordId = c.req.param("id");
  if (!activeOrg || !user || !draftId || !interviewRecordId) {
    throw new OfferDraftError("候选人或 Offer 记录不存在。", 404);
  }
  return {
    actor: { id: user.id, role: c.var.member?.role ?? null },
    draftId,
    interviewRecordId,
    organizationId: activeOrg.id,
    revision,
    source: "manual" as const,
  };
}

function errorResponse(error: unknown, c: Context<Env>) {
  if (error instanceof OfferDraftError) {
    return c.json({ error: error.message }, error.status);
  }
  throw error;
}

async function completionForm(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new OfferDraftError("SSC 确认参数无效。", 400);
  }
  const file = form.get("file");
  const input = completionFormSchema.safeParse({
    internalApprovalConfirmed: form.get("internalApprovalConfirmed"),
    revision: form.get("revision"),
  });
  if (
    !input.success ||
    (file !== null && !(file instanceof File)) ||
    form.getAll("file").length > 1 ||
    form.getAll("revision").length !== 1 ||
    form.getAll("internalApprovalConfirmed").length !== 1 ||
    [...form.keys()].some((key) => !["file", "revision", "internalApprovalConfirmed"].includes(key))
  ) {
    throw new OfferDraftError("请确认已经完成内部审批，并至多上传一张审批截图。", 400);
  }
  return { file: file ?? undefined, revision: input.data.revision };
}

export const offerSscRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    if (!c.var.activeOrg || !c.var.user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    return await next();
  })
  .get("/telegram-link", requirePermission("offer", "read"), async (c) => {
    try {
      const input = actionInput(c, 1);
      const context = await loadAuthorizedOfferSscContext({
        ...input,
        actorUserId: input.actor.id,
      });
      if (["deleted", "superseded"].includes(context.draft.status)) {
        return c.json({ error: "此 Offer 已不可操作。" }, 409);
      }
      return c.json({ url: buildTelegramOfferLink(context.draft.id) }, 200);
    } catch (error) {
      return errorResponse(error, c);
    }
  })
  .post(
    "/receive",
    requirePermission("offer", "receive"),
    zValidator("json", actionSchema, jsonValidatorError("SSC 确认参数无效。")),
    async (c) => {
      try {
        return c.json(
          await receiveOfferSscConfirmation(actionInput(c, c.req.valid("json").revision)),
          200,
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  )
  .post(
    "/complete",
    requirePermission("offer", "confirm"),
    zValidator("json", completionSchema, jsonValidatorError("请确认已经完成内部审批。")),
    async (c) => {
      try {
        return c.json(
          await completeOfferSscConfirmation({
            ...actionInput(c, c.req.valid("json").revision),
            internalApprovalConfirmed: true,
          }),
          200,
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  )
  .post(
    "/complete-with-attachment",
    requirePermission("offer", "confirm"),
    bodyLimit({
      maxSize: MAX_SSC_COMPLETION_SCREENSHOT_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: "审批截图请求过大，图片不能超过 10 MB。" }, 413),
    }),
    async (c) => {
      try {
        const form = await completionForm(c.req.raw);
        return c.json(
          await completeOfferSscWithScreenshot({
            ...actionInput(c, form.revision),
            file: form.file,
            internalApprovalConfirmed: true,
          }),
          200,
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  )
  .get("/completion-attachment", requirePermission("offer", "read"), async (c) => {
    try {
      const input = actionInput(c, 1);
      const attachment = await loadOfferSscCompletionAttachment({
        ...input,
        actorUserId: input.actor.id,
      });
      if (!attachment) {
        return c.json({ error: "审批截图不存在。" }, 404);
      }
      const object = await getObjectStream(attachment.storageKey);
      if (!object) {
        return c.json({ error: "审批截图不存在。" }, 404);
      }
      return new Response(object.body, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename="approval-screenshot"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
          "Content-Type": attachment.mediaType,
          "X-Content-Type-Options": "nosniff",
          ...(object.contentLength !== undefined && {
            "Content-Length": String(object.contentLength),
          }),
        },
      });
    } catch (error) {
      return errorResponse(error, c);
    }
  });
