import { zValidator } from "@hono/zod-validator";
import {
  odcAssignmentCreateSchema,
  odcAssignmentBatchCreateSchema,
  odcAssignmentSchema,
  odcAssignmentUpdateSchema,
} from "@arc/shared/hiring-units";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  createResumeSourceOdcAssignments,
  deleteResumeSourceOdcAssignment,
  queryPaginatedResumeSourceOdcAssignments,
  replaceResumeSourceOdcMembers,
  updateResumeSourceOdcAssignment,
} from "./dao";
import { areEligibleOdcMembers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/odc-assignment";
import { loadResumeSourceById } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-sources/dao";
import { odcAssignmentPaginationSchema } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/routes/odc/schema";

export const resumeSourceOdcRouter = factory
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
        return c.json({ error: "简历来源不存在。" }, 404);
      }
      const { assignments } = c.req.valid("json");
      const memberIds = assignments.map((assignment) => assignment.memberId);
      if (!(await areEligibleOdcMembers({ memberIds, organizationId: activeOrg.id }))) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const updated = await replaceResumeSourceOdcMembers({
        assignments,
        id,
        organizationId: activeOrg.id,
      });
      if (!updated) {
        return c.json({ error: "简历来源不存在。" }, 404);
      }
      safeUpdateTag(`resume-sources:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .post(
    "/",
    requirePermission("hiringUnit", "update"),
    zValidator(
      "json",
      odcAssignmentCreateSchema.or(odcAssignmentBatchCreateSchema),
      jsonValidatorError("ODC 设置参数无效。"),
    ),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id || !(await loadResumeSourceById(id, activeOrg.id))) {
        return c.json({ error: "简历来源不存在。" }, 404);
      }
      const input = c.req.valid("json");
      const assignments = "assignments" in input ? input.assignments : [input];
      if (
        !(await areEligibleOdcMembers({
          memberIds: assignments.map((assignment) => assignment.memberId),
          organizationId: activeOrg.id,
        }))
      ) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const created = await createResumeSourceOdcAssignments({
        assignments,
        organizationId: activeOrg.id,
        resumeSourceId: id,
      });
      if (!created) {
        return c.json({ error: "所选人员中已有 ODC 配置，请刷新后重试。" }, 409);
      }
      safeUpdateTag(`resume-sources:${activeOrg.id}`);
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
      if (!id || !(await loadResumeSourceById(id, activeOrg.id))) {
        return c.json({ error: "简历来源不存在。" }, 404);
      }
      return c.json(
        await queryPaginatedResumeSourceOdcAssignments({
          organizationId: activeOrg.id,
          pagination: c.req.valid("query"),
          resumeSourceId: id,
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
        return c.json({ error: "简历来源不存在。" }, 404);
      }
      const updated = await updateResumeSourceOdcAssignment({
        input: c.req.valid("json"),
        memberId: c.req.param("memberId"),
        organizationId: activeOrg.id,
        resumeSourceId: id,
      });
      if (!updated) {
        return c.json({ error: "ODC 配置不存在。" }, 404);
      }
      safeUpdateTag(`resume-sources:${activeOrg.id}`);
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
      return c.json({ error: "简历来源不存在。" }, 404);
    }
    const deleted = await deleteResumeSourceOdcAssignment({
      memberId: c.req.param("memberId"),
      organizationId: activeOrg.id,
      resumeSourceId: id,
    });
    if (!deleted) {
      return c.json({ error: "ODC 配置不存在。" }, 404);
    }
    safeUpdateTag(`resume-sources:${activeOrg.id}`);
    return c.json({ success: true }, 200);
  });
