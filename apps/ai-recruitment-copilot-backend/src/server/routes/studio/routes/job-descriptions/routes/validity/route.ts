import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { enqueueJobDescriptionIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue";
import { jobDescription } from "@arc/db-schema/schema";
import { safeUpdateTag } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { loadJobDescriptionById } from "../../dao";
import {
  buildJobDescriptionAuditChanges,
  recordJobDescriptionAudit,
} from "../../utils/job-description-audit";

export const jobDescriptionValidityRouter = factory
  .createApp()
  .patch(
    "/",
    requirePermission("jd", "update"),
    zValidator(
      "json",
      z.object({ manuallyInactive: z.boolean() }),
      jsonValidatorError("状态参数无效。"),
    ),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const id = c.req.param("id");
      if (!id || !(await loadJobDescriptionById(activeOrg.id, id, { actorUserId: user.id }))) {
        return c.json({ error: "在招岗位不存在。" }, 404);
      }
      const { manuallyInactive } = c.req.valid("json");
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(jobDescription)
          .where(and(eq(jobDescription.id, id), eq(jobDescription.organizationId, activeOrg.id)))
          .for("update")
          .limit(1);
        if (!current) {
          return "missing" as const;
        }
        if (!manuallyInactive && current.googleSheetDeleted === true) {
          return "google_deleted" as const;
        }
        if (current.manuallyInactive === manuallyInactive) {
          return "unchanged" as const;
        }
        await tx
          .update(jobDescription)
          .set({ manuallyInactive, updatedAt: now })
          .where(eq(jobDescription.id, id));
        await recordJobDescriptionAudit(tx, {
          action: "updated",
          changes: buildJobDescriptionAuditChanges(current, { manuallyInactive }, [
            "manuallyInactive",
          ]),
          createdAt: now,
          jobCode: current.code,
          jobDescriptionId: id,
          jobName: current.name,
          operatorId: user.id,
          operatorRole: c.var.member?.role ?? null,
          organizationId: activeOrg.id,
          source: "manual",
        });
        return "updated" as const;
      });
      if (result === "missing") {
        return c.json({ error: "在招岗位不存在。" }, 404);
      }
      if (result === "google_deleted") {
        return c.json({ error: "Google 文档中已删除该岗位，无法手动设为生效。" }, 409);
      }
      if (result === "updated") {
        safeUpdateTag(`job-descriptions:${activeOrg.id}`);
        await enqueueJobDescriptionIndexJobBestEffort({
          jobDescriptionId: id,
          organizationId: activeOrg.id,
        });
      }
      return c.json({ manuallyInactive }, 200);
    },
  );
