import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { getWorkspaceRequestContext } from "@arc/ai-recruitment-copilot-backend/server/context/workspace-request-context";
import {
  createSscResponsibility,
  deleteSscResponsibility,
  loadSscResponsibilityAdministrator,
  queryPaginatedSscResponsibilities,
  updateSscResponsibility,
} from "./dao";
import { sscResponsibilitiesQuerySchema, sscResponsibilityInputSchema } from "./schema";

export const sscResponsibilitiesRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "仅工作区管理员可以维护 SSC 负责组织。" }, 403);
    }
    const administrator = await loadSscResponsibilityAdministrator(activeOrg.id, user.id);
    if (!administrator) {
      return c.json({ error: "仅工作区管理员可以维护 SSC 负责组织。" }, 403);
    }
    c.set("member", administrator);
    return await next();
  })
  .use("*", requirePermission("page", "sscResponsibilities"))
  .get(
    "/",
    zValidator("query", sscResponsibilitiesQuerySchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const result = await queryPaginatedSscResponsibilities(
        getWorkspaceRequestContext(c).organization.id,
        c.req.valid("query"),
      );
      return c.json(result, 200);
    },
  )
  .post(
    "/",
    zValidator("json", sscResponsibilityInputSchema, jsonValidatorError("SSC 负责组织信息无效。")),
    async (c) => {
      const result = await createSscResponsibility(
        getWorkspaceRequestContext(c).organization.id,
        c.req.valid("json"),
      );
      if (result === "duplicate") {
        return c.json({ error: "该中心/部门与 SSC 邮箱的对应关系已存在。" }, 409);
      }
      return c.json(result, 201);
    },
  )
  .patch(
    "/:id",
    zValidator("json", sscResponsibilityInputSchema, jsonValidatorError("SSC 负责组织信息无效。")),
    async (c) => {
      const result = await updateSscResponsibility(
        getWorkspaceRequestContext(c).organization.id,
        c.req.param("id"),
        c.req.valid("json"),
      );
      if (result === "not_found") {
        return c.json({ error: "SSC 负责组织信息不存在。" }, 404);
      }
      if (result === "duplicate") {
        return c.json({ error: "该中心/部门与 SSC 邮箱的对应关系已存在。" }, 409);
      }
      return c.json(result, 200);
    },
  )
  .delete("/:id", async (c) => {
    const deleted = await deleteSscResponsibility(
      getWorkspaceRequestContext(c).organization.id,
      c.req.param("id"),
    );
    if (!deleted) {
      return c.json({ error: "SSC 负责组织信息不存在。" }, 404);
    }
    return c.json({ success: true }, 200);
  });
