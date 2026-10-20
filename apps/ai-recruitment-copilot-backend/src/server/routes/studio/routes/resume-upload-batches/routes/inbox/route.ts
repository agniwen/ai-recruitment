import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { historicalResumeImportQuerySchema, uploadTaskInboxQuerySchema } from "./schema";
import { listHistoricalResumeImports, listUploadTaskInbox } from "./utils";
import { retryUploadItem } from "../../utils/retry-upload-item";

export const uploadTaskInboxRouter = factory
  .createApp()
  .post("/:itemId/retry", requirePermission("resumeUploadBatch", "process"), async (c) => {
    const { activeOrg, user } = c.var;
    if (!activeOrg || !user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    try {
      const result = await retryUploadItem({
        itemId: c.req.param("itemId"),
        organizationId: activeOrg.id,
        requestedBy: user.id,
        userId: user.id,
      });
      if (result.status === "queued") {
        return c.json(result, 200);
      }
      if (result.status === "not_found") {
        return c.json({ error: "上传任务不存在。" }, 404);
      }
      if (result.status === "queue_unavailable") {
        return c.json({ error: "简历解析队列暂不可用，请稍后重试。" }, 503);
      }
      return c.json({ error: "只有解析失败的任务可以重试，请刷新任务状态。" }, 409);
    } catch {
      return c.json({ error: "重试入队失败，请稍后重试。" }, 503);
    }
  })
  .get(
    "/historical",
    requirePermission("resumeUploadBatch", "read"),
    zValidator("query", historicalResumeImportQuerySchema, jsonValidatorError("请求参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const { page } = c.req.valid("query");
      return c.json(await listHistoricalResumeImports({ organizationId: activeOrg.id, page }), 200);
    },
  )
  .get(
    "/",
    requirePermission("resumeUploadBatch", "read"),
    zValidator("query", uploadTaskInboxQuerySchema, jsonValidatorError("请求参数无效。")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const { cursor } = c.req.valid("query");
      const result = await listUploadTaskInbox({
        cursor: cursor ?? null,
        organizationId: activeOrg.id,
        userId: user.id,
      });
      return c.json(result, 200);
    },
  );
