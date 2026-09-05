import { listTextFiltersSchema } from "@arc/shared/list-text-filters";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, hiringUnit } from "@arc/db-schema/schema";
import { departmentFormSchema, departmentUpdateSchema } from "@arc/shared/departments";
import { odcAssignmentSchema } from "@arc/shared/hiring-units";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  listAllDepartments,
  loadDepartmentById,
  loadDepartmentReferenceCounts,
  queryPaginatedDepartments,
  replaceDepartmentOdcMembers,
  serializeDepartment,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/departments/dao";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { resolveHiringUnitAccessScope } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/utils/hiring-unit-scope";
import { areEligibleOdcMembers } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/odc-assignment";

const departmentListQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.string().optional(),
  textFilters: listTextFiltersSchema("departments"),
});

async function validateDepartmentHiringUnit({
  actorUserId,
  hiringUnitId,
  organizationId,
}: {
  actorUserId: string | null | undefined;
  hiringUnitId: string | null | undefined;
  organizationId: string;
}): Promise<string | null> {
  if (!hiringUnitId) {
    return null;
  }
  const [row] = await db
    .select({ id: hiringUnit.id })
    .from(hiringUnit)
    .where(and(eq(hiringUnit.id, hiringUnitId), eq(hiringUnit.organizationId, organizationId)))
    .limit(1);
  if (!row) {
    return "所选用人组织不存在。";
  }

  const scope = await resolveHiringUnitAccessScope({ actorUserId, organizationId });
  if (scope.canAccessAll || scope.hiringUnitIds.includes(hiringUnitId)) {
    return null;
  }
  return "所选用人组织不在当前招聘组负责范围内。";
}

export const departmentsRouter = factory
  .createApp()
  .get(
    "/",
    requirePermission("department", "read"),
    zValidator("query", departmentListQuerySchema, jsonValidatorError("查询参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const q = c.req.valid("query");
      const result = await queryPaginatedDepartments(
        {
          actorUserId: c.var.user?.id,
          organizationId: activeOrg.id,
          search: q.search,
          textFilters: q.textFilters,
        },
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
  .get("/all", requirePermission("department", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const records = await listAllDepartments(activeOrg.id, { actorUserId: c.var.user?.id });
    return c.json({ records }, 200);
  })
  .post(
    "/",
    requirePermission("department", "create"),
    zValidator("json", departmentFormSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const hiringUnitId = input.hiringUnitId ?? null;
      const hiringUnitError = await validateDepartmentHiringUnit({
        actorUserId: c.var.user?.id,
        hiringUnitId,
        organizationId: activeOrg.id,
      });
      if (hiringUnitError) {
        return c.json({ error: hiringUnitError }, 400);
      }
      const now = new Date();
      const record = {
        createdAt: now,
        createdBy: c.var.user?.id ?? null,
        description: input.description?.trim() || null,
        hiringUnitId,
        id: crypto.randomUUID(),
        name: input.name.trim(),
        organizationId: activeOrg.id,
        updatedAt: now,
      } satisfies typeof department.$inferInsert;

      await db.insert(department).values(record);
      safeUpdateTag(`departments:${activeOrg.id}`);

      return c.json(serializeDepartment(record), 201);
    },
  )
  .get("/:id", requirePermission("department", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const record = await loadDepartmentById(id, activeOrg.id, { actorUserId: c.var.user?.id });
    if (!record) {
      return c.json({ error: "部门不存在。" }, 404);
    }
    return c.json(record, 200);
  })
  .patch(
    "/:id",
    requirePermission("department", "update"),
    zValidator("json", departmentUpdateSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      const existing = await loadDepartmentById(id, activeOrg.id, { actorUserId: c.var.user?.id });
      if (!existing) {
        return c.json({ error: "部门不存在。" }, 404);
      }

      const input = c.req.valid("json");
      const hiringUnitId = input.hiringUnitId ?? null;
      const hiringUnitError = await validateDepartmentHiringUnit({
        actorUserId: c.var.user?.id,
        hiringUnitId,
        organizationId: activeOrg.id,
      });
      if (hiringUnitError) {
        return c.json({ error: hiringUnitError }, 400);
      }
      const now = new Date();
      await db
        .update(department)
        .set({
          description: input.description?.trim() || null,
          hiringUnitId,
          name: input.name.trim(),
          updatedAt: now,
        })
        .where(and(eq(department.id, id), eq(department.organizationId, activeOrg.id)));

      safeUpdateTag(`departments:${activeOrg.id}`);
      const updated = await loadDepartmentById(id, activeOrg.id, { actorUserId: c.var.user?.id });
      return c.json(updated, 200);
    },
  )
  .put(
    "/:id/odc",
    requirePermission("department", "update"),
    zValidator("json", odcAssignmentSchema, jsonValidatorError("ODC 设置参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      const existing = await loadDepartmentById(id, activeOrg.id, {
        actorUserId: c.var.user?.id,
      });
      if (!existing) {
        return c.json({ error: "部门不存在。" }, 404);
      }
      const { memberIds } = c.req.valid("json");
      if (!(await areEligibleOdcMembers({ memberIds, organizationId: activeOrg.id }))) {
        return c.json({ error: "所选成员中存在角色未标记为 ODC 的人员。" }, 400);
      }
      const updated = await replaceDepartmentOdcMembers({
        id,
        memberIds,
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
  .delete("/:id", requirePermission("department", "delete"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const existing = await loadDepartmentById(id, activeOrg.id, { actorUserId: c.var.user?.id });
    if (!existing) {
      return c.json({ error: "部门不存在。" }, 404);
    }

    const refs = await loadDepartmentReferenceCounts(id);
    if (refs.interviewerCount > 0 || refs.jobDescriptionCount > 0) {
      return c.json({ error: "该部门下仍有面试官或在招岗位，无法删除。", refs }, 400);
    }

    await db
      .delete(department)
      .where(and(eq(department.id, id), eq(department.organizationId, activeOrg.id)));
    safeUpdateTag(`departments:${activeOrg.id}`);
    return c.json({ success: true }, 200);
  });
