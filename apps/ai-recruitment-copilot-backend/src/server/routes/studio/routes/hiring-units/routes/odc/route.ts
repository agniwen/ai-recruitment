import { zValidator } from "@hono/zod-validator";
import {
  odcAssignmentCreateSchema,
  odcAssignmentSchema,
  odcAssignmentUpdateSchema,
} from "@arc/shared/hiring-units";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  createHiringUnitOdcAssignment,
  deleteHiringUnitOdcAssignment,
  queryPaginatedHiringUnitOdcAssignments,
  replaceHiringUnitOdcMembers,
  updateHiringUnitOdcAssignment,
} from "./dao";
import { areEligibleOdcMembers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/odc-assignment";
import { loadHiringUnitById } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";
import { odcAssignmentPaginationSchema } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/routes/odc/schema";

export const hiringUnitOdcRouter = factory
  .createApp()
  .put(
    "/",
    requirePermission("hiringUnit", "update"),
    zValidator("json", odcAssignmentSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }
      const { assignments } = c.req.valid("json");
      const memberIds = assignments.map((assignment) => assignment.memberId);
      if (!(await areEligibleOdcMembers({ memberIds, organizationId: activeOrg.id }))) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const updated = await replaceHiringUnitOdcMembers({
        assignments,
        id,
        organizationId: activeOrg.id,
      });
      if (!updated) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .post(
    "/",
    requirePermission("hiringUnit", "update"),
    zValidator("json", odcAssignmentCreateSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id || !(await loadHiringUnitById(id, activeOrg.id))) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }
      const input = c.req.valid("json");
      if (
        !(await areEligibleOdcMembers({
          memberIds: [input.memberId],
          organizationId: activeOrg.id,
        }))
      ) {
        return c.json({ error: "所选成员的角色未标记为 ODC。" }, 400);
      }
      const created = await createHiringUnitOdcAssignment({
        hiringUnitId: id,
        input,
        organizationId: activeOrg.id,
      });
      if (!created) {
        return c.json({ error: "该 ODC 配置已存在。" }, 409);
      }
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 201);
    },
  )
  .get(
    "/",
    requirePermission("hiringUnit", "update"),
    zValidator("query", odcAssignmentPaginationSchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id || !(await loadHiringUnitById(id, activeOrg.id))) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }
      return c.json(
        await queryPaginatedHiringUnitOdcAssignments({
          hiringUnitId: id,
          organizationId: activeOrg.id,
          pagination: c.req.valid("query"),
        }),
        200,
      );
    },
  )
  .patch(
    "/:memberId",
    requirePermission("hiringUnit", "update"),
    zValidator("json", odcAssignmentUpdateSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }
      const updated = await updateHiringUnitOdcAssignment({
        hiringUnitId: id,
        input: c.req.valid("json"),
        memberId: c.req.param("memberId"),
        organizationId: activeOrg.id,
      });
      if (!updated) {
        return c.json({ error: "ODC 配置不存在。" }, 404);
      }
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .delete("/:memberId", requirePermission("hiringUnit", "update"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "用人组织不存在。" }, 404);
    }
    const deleted = await deleteHiringUnitOdcAssignment({
      hiringUnitId: id,
      memberId: c.req.param("memberId"),
      organizationId: activeOrg.id,
    });
    if (!deleted) {
      return c.json({ error: "ODC 配置不存在。" }, 404);
    }
    safeUpdateTag(`hiring-units:${activeOrg.id}`);
    return c.json({ success: true }, 200);
  });
