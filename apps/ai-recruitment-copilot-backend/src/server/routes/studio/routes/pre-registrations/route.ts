import { getWorkspaceRequestContext } from "@arc/ai-recruitment-copilot-backend/server/context/workspace-request-context";
import { eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { organizationRole } from "@arc/db-schema/schema";
import { isWorkspaceAdministratorRole } from "@arc/shared/permissions";
import { canAssignWorkspaceRole } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-roles";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  createStudioPreRegistration,
  deleteStudioPreRegistration,
  listStudioPreRegistrationManagerOptions,
  queryPaginatedStudioPreRegistrations,
  updateStudioPreRegistration,
} from "./dao";
import { provisionPreRegisteredUserByEmail } from "./provisioning";
import { studioPreRegistrationInputSchema, studioPreRegistrationsQuerySchema } from "./schema";

function mutationErrorResponse(
  c: Context,
  result: "cycle" | "duplicate" | "manager_not_found" | "not_found",
) {
  if (result === "not_found" || result === "manager_not_found") {
    return c.json(
      { error: result === "not_found" ? "预录入信息不存在。" : "直属上级不存在。" },
      404,
    );
  }
  if (result === "duplicate") {
    return c.json({ error: "该邮箱已存在预录入信息。" }, 409);
  }
  return c.json({ error: "直属上级关系不能形成循环。" }, 409);
}

export const studioPreRegistrationsRouter = factory
  .createApp()
  .use("*", async (c, next) => {
    if (!c.var.activeOrg || !isWorkspaceAdministratorRole(c.var.member?.role)) {
      return c.json({ error: "仅工作区管理员可以管理预录入信息。" }, 403);
    }
    return await next();
  })
  .use("*", requirePermission("page", "preRegistrations"))
  .get("/role-options", async (c) => {
    const { member, organization } = getWorkspaceRequestContext(c);
    const customRoles = await db
      .select({ label: organizationRole.name, value: organizationRole.role })
      .from(organizationRole)
      .where(eq(organizationRole.organizationId, organization.id));
    const builtInRoles = [
      ...(member.role === "owner" ? [{ label: "管理员", value: "admin" }] : []),
      { label: "成员", value: "member" },
      { label: "无权限", value: "noAccess" },
    ];
    return c.json({ records: [...builtInRoles, ...customRoles] }, 200);
  })
  .get(
    "/",
    zValidator("query", studioPreRegistrationsQuerySchema, jsonValidatorError("参数校验失败")),
    async (c) => {
      const result = await queryPaginatedStudioPreRegistrations(
        getWorkspaceRequestContext(c).organization.slug,
        c.req.valid("query"),
      );
      return c.json(result, 200);
    },
  )
  .get("/manager-options", async (c) => {
    const records = await listStudioPreRegistrationManagerOptions(
      getWorkspaceRequestContext(c).organization.slug,
    );
    return c.json({ records }, 200);
  })
  .post(
    "/",
    zValidator("json", studioPreRegistrationInputSchema, jsonValidatorError("预录入信息无效。")),
    async (c) => {
      const { member, organization } = getWorkspaceRequestContext(c);
      if (
        !(await canAssignWorkspaceRole({
          invokerRole: member.role,
          organizationId: organization.id,
          targetRole: c.req.valid("json").workspaceRole,
        }))
      ) {
        return c.json({ error: "无法分配该工作区角色，请重新选择。" }, 403);
      }
      const result = await createStudioPreRegistration(organization.slug, c.req.valid("json"));
      if (typeof result === "string") {
        return mutationErrorResponse(c, result);
      }
      await provisionPreRegisteredUserByEmail(result.email, organization.slug);
      return c.json({ id: result.id }, 201);
    },
  )
  .patch(
    "/:id",
    zValidator("json", studioPreRegistrationInputSchema, jsonValidatorError("预录入信息无效。")),
    async (c) => {
      const { member, organization } = getWorkspaceRequestContext(c);
      if (
        !(await canAssignWorkspaceRole({
          invokerRole: member.role,
          organizationId: organization.id,
          targetRole: c.req.valid("json").workspaceRole,
        }))
      ) {
        return c.json({ error: "无法分配该工作区角色，请重新选择。" }, 403);
      }
      const result = await updateStudioPreRegistration(
        organization.slug,
        c.req.param("id"),
        c.req.valid("json"),
      );
      if (typeof result === "string") {
        return mutationErrorResponse(c, result);
      }
      await provisionPreRegisteredUserByEmail(result.email, organization.slug);
      return c.json({ id: result.id }, 200);
    },
  )
  .delete("/:id", async (c) => {
    const deleted = await deleteStudioPreRegistration(
      getWorkspaceRequestContext(c).organization.slug,
      c.req.param("id"),
    );
    if (!deleted) {
      return c.json({ error: "预录入信息不存在。" }, 404);
    }
    return c.json({ success: true }, 200);
  });
