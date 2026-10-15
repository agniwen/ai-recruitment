import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { adminMiddleware } from "@arc/ai-recruitment-copilot-backend/server/middlewares/admin";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { getJobMatchingIndexStatus, startJobMatchingIndexRebuild } from "./utils";

export const jobMatchingIndexRouter = factory
  .createApp()
  .use(adminMiddleware)
  .use(requirePermission("jd", "update"))
  .get("/", async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json(await getJobMatchingIndexStatus(activeOrg.id), 200);
  })
  .post("/rebuild", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      const result = await startJobMatchingIndexRebuild(activeOrg.id);
      console.info("[job-matching-index] rebuild queued", {
        organizationId: activeOrg.id,
        queued: result.queued,
        userId: user.id,
      });
      return c.json(result, 202);
    } catch {
      return c.json(
        { error: "岗位向量任务未能入队，请检查模型、Qdrant 和后台队列配置后重试。" },
        503,
      );
    }
  })
  .post("/retry-failed", async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      const result = await startJobMatchingIndexRebuild(activeOrg.id, { failedOnly: true });
      console.info("[job-matching-index] failed jobs requeued", {
        organizationId: activeOrg.id,
        queued: result.queued,
        userId: user.id,
      });
      return c.json(result, 202);
    } catch {
      return c.json(
        { error: "失败岗位未能重新入队，请检查模型、Qdrant 和后台队列配置后重试。" },
        503,
      );
    }
  });
