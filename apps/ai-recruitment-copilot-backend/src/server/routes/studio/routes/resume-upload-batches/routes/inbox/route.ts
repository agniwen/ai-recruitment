import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { historicalResumeImportQuerySchema, uploadTaskInboxQuerySchema } from "./schema";
import { listHistoricalResumeImports, listUploadTaskInbox } from "./utils";

export const uploadTaskInboxRouter = factory
  .createApp()
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
