import { and, eq, sql } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { jobMatchingProfileSchema } from "@arc/db-schema/job-matching";
import { jobDescription, jobMatchingProfile } from "@arc/db-schema/schema";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { enqueueJobDescriptionIndexJobBestEffort } from "@arc/ai-recruitment-copilot-backend/lib/server/jd-semantic/enqueue";
import { loadJobDescriptionById } from "../../dao";
import { ensureJobMatchingProfile, matchingProfileSourceHash } from "../../utils/matching-profile";

export const jobMatchingProfileRouter = factory
  .createApp()
  .use(requirePermission("jd", "read"))
  .get("/", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const job = await loadJobDescriptionById(activeOrg.id, c.req.param("id") ?? "", {
      actorUserId: user.id,
    });
    if (!job) {
      return c.json({ error: "岗位不存在或无权访问。" }, 404);
    }
    const [row] = await db
      .select()
      .from(jobMatchingProfile)
      .where(eq(jobMatchingProfile.jobDescriptionId, job.id));
    return c.json(
      {
        confirmed: Boolean(row?.confirmedAt),
        profile: row?.profile ?? null,
        stale: Boolean(row && row.sourceHash !== matchingProfileSourceHash(job)),
      },
      200,
    );
  })
  .post("/analyze", requirePermission("jd", "update"), async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const job = await loadJobDescriptionById(activeOrg.id, c.req.param("id") ?? "", {
      actorUserId: user.id,
    });
    if (!job) {
      return c.json({ error: "岗位不存在或无权访问。" }, 404);
    }
    try {
      const row = await ensureJobMatchingProfile(job);
      await enqueueJobDescriptionIndexJobBestEffort({
        jobDescriptionId: job.id,
        organizationId: activeOrg.id,
      });
      return c.json(
        {
          confirmed: Boolean(row.confirmedAt),
          profile: row.profile,
          stale: row.sourceHash !== matchingProfileSourceHash(job),
        },
        200,
      );
    } catch {
      return c.json({ error: "岗位画像分析未完成，请稍后重试。" }, 502);
    }
  })
  .put(
    "/",
    requirePermission("jd", "update"),
    zValidator("json", jobMatchingProfileSchema, jsonValidatorError("画像字段无效。")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const job = await loadJobDescriptionById(activeOrg.id, c.req.param("id") ?? "", {
        actorUserId: user.id,
      });
      if (!job) {
        return c.json({ error: "岗位不存在或无权访问。" }, 404);
      }
      const profile = c.req.valid("json");
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`job-matching:${job.id}`}, 0))`,
        );
        const [current] = await tx
          .select()
          .from(jobDescription)
          .where(
            and(eq(jobDescription.id, job.id), eq(jobDescription.organizationId, activeOrg.id)),
          );
        if (!current || matchingProfileSourceHash(current) !== matchingProfileSourceHash(job)) {
          throw new Error("岗位内容已变化，请重新打开后保存。");
        }
        const values = {
          confirmedAt: new Date(),
          profile,
          sourceHash: matchingProfileSourceHash(job),
          updatedAt: new Date(),
          updatedBy: user.id,
        };
        await tx
          .insert(jobMatchingProfile)
          .values({ jobDescriptionId: job.id, ...values })
          .onConflictDoUpdate({ set: values, target: jobMatchingProfile.jobDescriptionId });
      });
      await enqueueJobDescriptionIndexJobBestEffort({
        jobDescriptionId: job.id,
        organizationId: activeOrg.id,
      });
      return c.json({ confirmed: true, profile, stale: false }, 200);
    },
  );
