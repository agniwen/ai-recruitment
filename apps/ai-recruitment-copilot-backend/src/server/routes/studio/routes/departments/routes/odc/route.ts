import { zValidator } from "@hono/zod-validator";
import { odcAssignmentSchema, odcAssignmentUpdateSchema } from "@arc/shared/hiring-units";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  deleteDepartmentOdcAssignment,
  queryPaginatedDepartmentOdcAssignments,
  replaceDepartmentOdcMembers,
  updateDepartmentOdcAssignment,
} from "./dao";
import { loadDepartmentById } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { areEligibleOdcMembers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/odc-assignment";
import { odcAssignmentPaginationSchema } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/routes/odc/schema";

export const departmentOdcRouter = factory
  .createApp()
  .put(
    "/",
    requirePermission("department", "update"),
    zValidator("json", odcAssignmentSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      const existing = await loadDepartmentById(id, activeOrg.id, {
        actorUserId: c.var.user?.id,
      });
      if (!existing) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      const { assignments } = c.req.valid("json");
      const memberIds = assignments.map((assignment) => assignment.memberId);
      if (!(await areEligibleOdcMembers({ memberIds, organizationId: activeOrg.id }))) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const updated = await replaceDepartmentOdcMembers({
        assignments,
        id,
        organizationId: activeOrg.id,
      });
      if (!updated) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      safeUpdateTag(`departments:${activeOrg.id}`);
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .get(
    "/",
    requirePermission("department", "update"),
    zValidator("query", odcAssignmentPaginationSchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      const existing = await loadDepartmentById(id, activeOrg.id, {
        actorUserId: c.var.user?.id,
      });
      if (!existing) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      return c.json(
        await queryPaginatedDepartmentOdcAssignments({
          departmentId: id,
          organizationId: activeOrg.id,
          pagination: c.req.valid("query"),
        }),
        200,
      );
    },
  )
  .patch(
    "/:memberId",
    requirePermission("department", "update"),
    zValidator("json", odcAssignmentUpdateSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      if (
        !(await loadDepartmentById(id, activeOrg.id, {
          actorUserId: c.var.user?.id,
        }))
      ) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      const updated = await updateDepartmentOdcAssignment({
        departmentId: id,
        input: c.req.valid("json"),
        memberId: c.req.param("memberId"),
        organizationId: activeOrg.id,
      });
      if (!updated) {
        return c.json({ error: "ODC 配置不存在。" }, 404);
      }
      safeUpdateTag(`departments:${activeOrg.id}`);
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .delete("/:memberId", requirePermission("department", "update"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "部门不存在。" }, 404);
    }
    if (
      !(await loadDepartmentById(id, activeOrg.id, {
        actorUserId: c.var.user?.id,
      }))
    ) {
      return c.json({ error: "部门不存在。" }, 404);
    }
    const deleted = await deleteDepartmentOdcAssignment({
      departmentId: id,
      memberId: c.req.param("memberId"),
      organizationId: activeOrg.id,
    });
    if (!deleted) {
      return c.json({ error: "ODC 配置不存在。" }, 404);
    }
    safeUpdateTag(`departments:${activeOrg.id}`);
    safeUpdateTag(`hiring-units:${activeOrg.id}`);
    return c.json({ success: true }, 200);
  });
