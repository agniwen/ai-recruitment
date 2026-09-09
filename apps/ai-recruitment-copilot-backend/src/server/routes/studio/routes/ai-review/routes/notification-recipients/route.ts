import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { loadResumeDetail } from "../../../resumes/dao/resumes";
import { listAiReviewNotificationRecipients } from "../../dao";

export const aiReviewNotificationRecipientsRouter = factory
  .createApp()
  .use("*", requirePermission("aiReview", "approve"))
  .get("/", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const candidateId = c.req.param("id");
    if (!candidateId) {
      return c.json({ error: "待审批简历不存在。" }, 404);
    }
    const record = await loadResumeDetail(candidateId, activeOrg.id, { kind: "all" });
    if (!record || record.pipelineStage !== "ai_review") {
      return c.json({ error: "待审批简历不存在或已处理。" }, 404);
    }
    const recipients = await listAiReviewNotificationRecipients({
      candidateId,
      organizationId: activeOrg.id,
    });
    return c.json(
      {
        recipients: recipients.map(({ chatId, ...recipient }) => ({
          ...recipient,
          telegramBound: Boolean(chatId),
        })),
      },
      200,
    );
  });
