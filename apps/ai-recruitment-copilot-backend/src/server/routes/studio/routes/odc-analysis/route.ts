import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { loadOdcAnalysis, OdcAnalysisFilterError } from "./dao";
import { odcAnalysisQuerySchema } from "./schema";

export const odcAnalysisRouter = factory
  .createApp()
  .get(
    "/",
    requirePermission("page", "odcAnalysis"),
    zValidator("query", odcAnalysisQuerySchema, jsonValidatorError("ODC 分析筛选参数无效。")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!(activeOrg && user)) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      try {
        const filters = c.req.valid("query");
        return c.json(await loadOdcAnalysis(activeOrg.id, filters), 200);
      } catch (error) {
        if (error instanceof OdcAnalysisFilterError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  );
