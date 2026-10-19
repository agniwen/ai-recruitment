import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { getWorkspaceRequestContext } from "@arc/ai-recruitment-copilot-backend/server/context/workspace-request-context";
import {
  createSscResponsibility,
  deleteSscResponsibility,
  loadSscResponsibilityAdministrator,
  listSscResponsibilityOptions,
  queryPaginatedSscResponsibilities,
  updateSscResponsibility,
} from "./dao";
import {
  sscAssignmentCandidatesQuerySchema,
  sscResponsibilitiesQuerySchema,
  sscResponsibilityInputSchema,
  sscResponsibilityImportSchema,
  sscResponsibilityImportCommitSchema,
  sscSourceAssignmentInputSchema,
} from "./schema";
import { assignSscSourceCandidates, listSscAssignmentCandidates } from "./source-assignment-dao";
import { importSscResponsibilities, previewSscResponsibilityImport } from "./import-dao";

const SAVE_VALIDATION_MESSAGES = {
  invalid_role: "请选择当前工作区中标记为 SSC 的工作区角色。",
  invalid_source: "请选择当前工作区的部门/中心；未关联的历史记录仅可保留原名称。",
  role_conflict: "该邮箱对应的 SSC 工作区角色存在冲突，或账号已被限制，请先核对成员和负责关系。",
};

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
  .post(
    "/preview",
    zValidator(
      "json",
      sscResponsibilityImportSchema,
      jsonValidatorError("请检查导入内容，最多 500 行。"),
    ),
    async (c) =>
      c.json(
        await previewSscResponsibilityImport(
          getWorkspaceRequestContext(c).organization.id,
          c.req.valid("json"),
        ),
        200,
      ),
  )
  .post(
    "/import",
    zValidator(
      "json",
      sscResponsibilityImportCommitSchema,
      jsonValidatorError("请检查导入内容，最多 500 行。"),
    ),
    async (c) => {
      const result = await importSscResponsibilities(
        getWorkspaceRequestContext(c).organization.id,
        c.req.valid("json"),
      );
      if (!result.ok) {
        return c.json({ error: result.error, rows: result.rows }, 409);
      }
      return c.json({ added: result.added, skipped: result.skipped }, 200);
    },
  )
  .get("/options", async (c) =>
    c.json(await listSscResponsibilityOptions(getWorkspaceRequestContext(c).organization.id), 200),
  )
  .get(
    "/candidates",
    zValidator(
      "query",
      sscAssignmentCandidatesQuerySchema,
      jsonValidatorError("请选择部门/中心。"),
    ),
    async (c) => {
      const result = await listSscAssignmentCandidates(
        getWorkspaceRequestContext(c).organization.id,
        c.req.valid("query").resumeSourceId,
      );
      if (result === "invalid_source") {
        return c.json({ error: SAVE_VALIDATION_MESSAGES.invalid_source }, 400);
      }
      return c.json(result, 200);
    },
  )
  .post(
    "/assign",
    zValidator("json", sscSourceAssignmentInputSchema, jsonValidatorError("SSC 分配参数无效。")),
    async (c) => {
      const result = await assignSscSourceCandidates(
        getWorkspaceRequestContext(c).organization.id,
        c.req.valid("json"),
      );
      if (result === "invalid_source") {
        return c.json({ error: SAVE_VALIDATION_MESSAGES.invalid_source }, 400);
      }
      if (result === "duplicate") {
        return c.json({ error: "所选 SSC 已负责该部门/中心，请刷新后重试。" }, 409);
      }
      if (result === "stale") {
        return c.json({ error: "SSC 候选人员或角色已变化，请刷新后重新选择。" }, 409);
      }
      return c.json(result, 201);
    },
  )
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
        return c.json({ error: "该中心/部门与 SSC 人员的对应关系已存在。" }, 409);
      }
      if (result === "invalid_role" || result === "invalid_source" || result === "role_conflict") {
        return c.json({ error: SAVE_VALIDATION_MESSAGES[result] }, 400);
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
        return c.json({ error: "该中心/部门与 SSC 人员的对应关系已存在。" }, 409);
      }
      if (result === "invalid_role" || result === "invalid_source" || result === "role_conflict") {
        return c.json({ error: SAVE_VALIDATION_MESSAGES[result] }, 400);
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
