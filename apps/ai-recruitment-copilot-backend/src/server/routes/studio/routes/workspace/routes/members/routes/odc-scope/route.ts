import { zValidator } from "@hono/zod-validator";
import { memberOdcScopeInputSchema } from "@arc/db-schema/pre-registration";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { updateMemberOdcScope } from "./dao";

export const memberOdcScopeRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    if (!c.var.activeOrg || !isWorkspaceAdministratorRole(c.var.member?.role)) {
      return c.json({ error: "只有工作区管理员可以设置 ODC 负责范围。" }, 403);
    }
    return await next();
  })
  .put(
    "/",
    zValidator("json", memberOdcScopeInputSchema, jsonValidatorError("ODC 负责范围参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ error: "未登录。" }, 401);
      }
      const organizationId = activeOrg.id;
      const memberId = c.req.param("memberId");
      if (!memberId) {
        return c.json({ error: "成员不存在。" }, 404);
      }
      const result = await updateMemberOdcScope(organizationId, memberId, c.req.valid("json"));
      if (result === "not_found") {
        return c.json({ error: "成员不存在。" }, 404);
      }
      if (result === "not_odc") {
        return c.json({ error: "该成员角色未标记为 ODC。" }, 400);
      }
      if (result === "invalid_source") {
        return c.json({ error: "所选部门/中心不存在或不属于当前工作区。" }, 400);
      }
      safeUpdateTag(`resume-sources:${organizationId}`);
      return c.json({ success: true }, 200);
    },
  );
