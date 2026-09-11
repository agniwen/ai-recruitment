import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { rejectCandidateAiReview } from "./dao";

export const aiReviewRejectRouter = factory
  .createApp()
  .use("*", requirePermission("aiReview", "approve"))
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        approvalNote: z.string().trim().max(2000, "审批说明不能超过 2000 字").optional(),
      }),
      jsonValidatorError("请检查审批说明。"),
    ),
    async (c) => {
      const { activeOrg, user, member } = c.var;
      if (!activeOrg || !user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const candidateId = c.req.param("id");
      if (!candidateId) {
        return c.json({ error: "待审批简历不存在。" }, 404);
      }
      const result = await rejectCandidateAiReview({
        candidateId,
        operatorId: user.id,
        operatorRole: member?.role,
        organizationId: activeOrg.id,
        ...c.req.valid("json"),
      });
      if (result.kind === "forbidden") {
        return c.json({ error: "当前角色没有 AI 分析审批的审批权限。" }, 403);
      }
      if (result.kind === "not_found") {
        return c.json({ error: "待审批简历不存在或已处理。" }, 404);
      }
      if (result.kind === "invalid") {
        return c.json({ error: result.message }, 409);
      }
      return c.json({ ok: true }, 200);
    },
  );
