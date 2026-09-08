import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { hiringUnit, jobDescription, resumeSource } from "@arc/db-schema/schema";
import { resumeSourceFormSchema } from "@arc/shared/resume-sources";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { listResumeSources } from "./dao";
import { resumeSourceOdcRouter } from "./routes/odc/route";

// 简历来源与用人组织共用招聘组织管理权限。
export const resumeSourcesRouter = factory
  .createApp()
  .get("/", requirePermission("hiringUnit", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    return c.json({ records: await listResumeSources(activeOrg.id) }, 200);
  })
  .post(
    "/",
    requirePermission("hiringUnit", "create"),
    zValidator("json", resumeSourceFormSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const id = crypto.randomUUID();
      await db.insert(resumeSource).values({
        createdBy: c.var.user?.id ?? null,
        description: input.description || null,
        id,
        name: input.name,
        organizationId: activeOrg.id,
      });
      return c.json({ id }, 201);
    },
  )
  .patch(
    "/:id",
    requirePermission("hiringUnit", "update"),
    zValidator("json", resumeSourceFormSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const rows = await db.transaction(async (tx) => {
        const updated = await tx
          .update(resumeSource)
          .set({ description: input.description || null, name: input.name, updatedAt: new Date() })
          .where(
            and(
              eq(resumeSource.id, c.req.param("id")),
              eq(resumeSource.organizationId, activeOrg.id),
            ),
          )
          .returning({ id: resumeSource.id });
        if (updated.length) {
          await tx
            .update(jobDescription)
            .set({ sourceSheet: input.name })
            .where(
              and(
                eq(jobDescription.organizationId, activeOrg.id),
                eq(jobDescription.resumeSourceId, c.req.param("id")),
              ),
            );
        }
        return updated;
      });
      if (!rows.length) {
        return c.json({ error: "简历来源不存在。" }, 404);
      }
      return c.json({ success: true }, 200);
    },
  )
  .delete("/:id", requirePermission("hiringUnit", "delete"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const result = await db.transaction(async (tx) => {
      const [source] = await tx
        .select({ id: resumeSource.id })
        .from(resumeSource)
        .where(and(eq(resumeSource.id, id), eq(resumeSource.organizationId, activeOrg.id)))
        .for("update");
      if (!source) {
        return "missing";
      }
      const [unit] = await tx
        .select({ id: hiringUnit.id })
        .from(hiringUnit)
        .where(and(eq(hiringUnit.resumeSourceId, id), eq(hiringUnit.organizationId, activeOrg.id)))
        .limit(1);
      const [job] = await tx
        .select({ id: jobDescription.id })
        .from(jobDescription)
        .where(
          and(
            eq(jobDescription.resumeSourceId, id),
            eq(jobDescription.organizationId, activeOrg.id),
          ),
        )
        .limit(1);
      if (unit || job) {
        return "in_use";
      }
      await tx
        .delete(resumeSource)
        .where(and(eq(resumeSource.id, id), eq(resumeSource.organizationId, activeOrg.id)));
      return "deleted";
    });
    if (result === "missing") {
      return c.json({ error: "简历来源不存在。" }, 404);
    }
    if (result === "in_use") {
      return c.json({ error: "请先调整关联岗位和下属用人组织的简历来源，再删除。" }, 409);
    }
    return c.json({ success: true }, 200);
  })
  .route("/:id/odc", resumeSourceOdcRouter);
