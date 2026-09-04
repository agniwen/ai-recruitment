import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { hiringUnit } from "@arc/db-schema/schema";
import {
  hiringUnitFormSchema,
  hiringUnitUpdateSchema,
  odcBatchAssignmentSchema,
  odcAssignmentSchema,
} from "@arc/shared/hiring-units";
import { createRequestWorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import {
  listAllHiringUnits,
  listHiringUnitTree,
  listSelectableHiringUnits,
  loadHiringUnitById,
  queryPaginatedHiringUnits,
  replaceHiringUnitOdcMembers,
  replaceOdcMembersForTargets,
  serializeHiringUnit,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";
import { areEligibleOdcMembers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/odc-assignment";
import { areDepartmentsVisible } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";

const hiringUnitListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
});

export const hiringUnitsRouter = factory
  .createApp()
  .get(
    "/",
    requirePermission("hiringUnit", "read"),
    zValidator("query", hiringUnitListQuerySchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const q = c.req.valid("query");
      const result = await queryPaginatedHiringUnits(
        { organizationId: activeOrg.id, search: q.search },
        {
          page: q.page,
          pageSize: q.pageSize,
          sortBy: q.sortBy,
          sortOrder: q.sortOrder,
        },
      );
      return c.json(result, 200);
    },
  )
  .get("/all", requirePermission("hiringUnit", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const records = await listAllHiringUnits(activeOrg.id);
    return c.json({ records }, 200);
  })
  .get(
    "/tree",
    requirePermission("hiringUnit", "read"),
    requirePermission("department", "read"),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      return c.json(
        await listHiringUnitTree({
          actorUserId: c.var.user?.id,
          organizationId: activeOrg.id,
        }),
        200,
      );
    },
  )
  .get("/selectable", async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const records = await listSelectableHiringUnits({
      actorUserId: c.var.user?.id,
      organizationId: activeOrg.id,
    });
    return c.json({ records }, 200);
  })
  .post(
    "/",
    requirePermission("hiringUnit", "create"),
    zValidator("json", hiringUnitFormSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const now = new Date();
      const record = {
        createdAt: now,
        createdBy: c.var.user?.id ?? null,
        description: input.description?.trim() || null,
        id: crypto.randomUUID(),
        name: input.name.trim(),
        organizationId: activeOrg.id,
        updatedAt: now,
      } satisfies typeof hiringUnit.$inferInsert;

      await db.insert(hiringUnit).values(record);
      safeUpdateTag(`hiring-units:${activeOrg.id}`);

      return c.json(serializeHiringUnit(record), 201);
    },
  )
  .put(
    "/odc/batch",
    zValidator("json", odcBatchAssignmentSchema, jsonValidatorError("批量 ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const { memberIds, targets } = c.req.valid("json");
      const authorize = createRequestWorkspaceAuthorizer({
        headers: c.req.raw.headers,
        memberRole: c.var.member?.role,
        organizationId: activeOrg.id,
        userId: c.var.user?.id,
      });
      const [canUpdateHiringUnits, canUpdateDepartments] = await Promise.all([
        authorize({ action: "update", resource: "hiringUnit" }),
        authorize({ action: "update", resource: "department" }),
      ]);
      if (
        targets.some(
          (target) =>
            (target.rowType === "hiringUnit" && !canUpdateHiringUnits) ||
            (target.rowType === "department" && !canUpdateDepartments),
        )
      ) {
        return c.json({ message: "Forbidden" }, 403);
      }

      const departmentTargets = targets.filter((target) => target.rowType === "department");
      const departmentsVisible = await areDepartmentsVisible({
        actorUserId: c.var.user?.id,
        ids: departmentTargets.map((target) => target.id),
        organizationId: activeOrg.id,
      });
      if (!departmentsVisible) {
        return c.json({ error: "所选部门不存在或无权访问。" }, 404);
      }
      if (!(await areEligibleOdcMembers({ memberIds, organizationId: activeOrg.id }))) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const updated = await replaceOdcMembersForTargets({
        memberIds,
        organizationId: activeOrg.id,
        targets,
      });
      if (!updated) {
        return c.json({ error: "所选用人组织或部门不存在。" }, 404);
      }
      safeUpdateTag(`departments:${activeOrg.id}`);
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .get("/:id", requirePermission("hiringUnit", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const record = await loadHiringUnitById(id, activeOrg.id);
    if (!record) {
      return c.json({ error: "用人组织不存在。" }, 404);
    }
    return c.json(record, 200);
  })
  .patch(
    "/:id",
    requirePermission("hiringUnit", "update"),
    zValidator("json", hiringUnitUpdateSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      const existing = await loadHiringUnitById(id, activeOrg.id);
      if (!existing) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }

      const input = c.req.valid("json");
      const now = new Date();
      await db
        .update(hiringUnit)
        .set({
          description: input.description?.trim() || null,
          name: input.name.trim(),
          updatedAt: now,
        })
        .where(and(eq(hiringUnit.id, id), eq(hiringUnit.organizationId, activeOrg.id)));

      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      const updated = await loadHiringUnitById(id, activeOrg.id);
      return c.json(updated, 200);
    },
  )
  .put(
    "/:id/odc",
    requirePermission("hiringUnit", "update"),
    zValidator("json", odcAssignmentSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const { memberIds } = c.req.valid("json");
      if (!(await areEligibleOdcMembers({ memberIds, organizationId: activeOrg.id }))) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const updated = await replaceHiringUnitOdcMembers({
        id: c.req.param("id"),
        memberIds,
        organizationId: activeOrg.id,
      });
      if (!updated) {
        return c.json({ error: "用人组织不存在。" }, 404);
      }
      safeUpdateTag(`hiring-units:${activeOrg.id}`);
      return c.json({ success: true }, 200);
    },
  )
  .delete("/:id", requirePermission("hiringUnit", "delete"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await loadHiringUnitById(id, activeOrg.id);
    if (!existing) {
      return c.json({ error: "用人组织不存在。" }, 404);
    }

    await db
      .delete(hiringUnit)
      .where(and(eq(hiringUnit.id, id), eq(hiringUnit.organizationId, activeOrg.id)));
    safeUpdateTag(`hiring-units:${activeOrg.id}`);
    return c.json({ success: true }, 200);
  });
