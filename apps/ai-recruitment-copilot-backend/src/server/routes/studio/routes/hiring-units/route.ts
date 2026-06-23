import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { hiringUnit } from "@arc/db-schema/schema";
import { hiringUnitFormSchema, hiringUnitUpdateSchema } from "@arc/shared/hiring-units";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import {
  listAllHiringUnits,
  listSelectableHiringUnits,
  loadHiringUnitById,
  queryPaginatedHiringUnits,
  serializeHiringUnit,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/hiring-units/dao";

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
  .get("/selectable", requirePermission("hiringUnit", "read"), async (c) => {
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
