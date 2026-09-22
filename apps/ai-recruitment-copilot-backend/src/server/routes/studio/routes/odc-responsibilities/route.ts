import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import type { Env } from "@arc/ai-recruitment-copilot-backend/server/type";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import { importInput, scopeInput } from "./schema";
import {
  loadResponsibilityCatalog,
  previewResponsibilityRows,
  importResponsibilities,
  saveResponsibility,
} from "./dao";

function organizationId(c: Context<Env>) {
  if (!c.var.activeOrg) {
    throw new HTTPException(403);
  }
  return c.var.activeOrg.id;
}

export const odcResponsibilitiesRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    if (!c.var.activeOrg || !isWorkspaceAdministratorRole(c.var.member?.role)) {
      return c.json({ error: "仅工作区管理员可以维护 ODC 负责范围。" }, 403);
    }
    await next();
  })
  .get("/", async (c) => c.json(await loadResponsibilityCatalog(organizationId(c)), 200))
  .post(
    "/preview",
    zValidator("json", importInput, jsonValidatorError("请检查导入内容，最多 500 行。")),
    async (c) => {
      const catalog = await loadResponsibilityCatalog(organizationId(c));
      return c.json({ rows: previewResponsibilityRows(c.req.valid("json").rows, catalog) }, 200);
    },
  )
  .post(
    "/import",
    zValidator("json", importInput, jsonValidatorError("请检查导入内容。")),
    async (c) => {
      const result = await importResponsibilities(organizationId(c), c.req.valid("json").rows);
      if (!result.ok) {
        return c.json(
          { error: "配置已变化或存在未匹配记录，请重新预览。", rows: result.preview },
          409,
        );
      }
      return c.json({ added: result.added }, 200);
    },
  )
  .put("/", zValidator("json", scopeInput, jsonValidatorError("负责范围参数无效。")), async (c) => {
    const ok = await saveResponsibility(organizationId(c), c.req.valid("json"));
    if (!ok) {
      return c.json({ error: "成员不是 ODC 或部门不属于所选中心，请刷新后重试。" }, 400);
    }
    return c.json({ ok: true }, 200);
  });
