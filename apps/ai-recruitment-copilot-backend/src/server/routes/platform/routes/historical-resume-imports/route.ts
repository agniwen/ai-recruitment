import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { queryPaginatedHistoricalResumeImports } from "./dao";
import { historicalResumeImportQuerySchema } from "./schema";

export const platformHistoricalResumeImportsRouter = factory
  .createApp()
  .get(
    "/",
    zValidator("query", historicalResumeImportQuerySchema, jsonValidatorError("参数校验失败")),
    async (c) => c.json(await queryPaginatedHistoricalResumeImports(c.req.valid("query")), 200),
  );
