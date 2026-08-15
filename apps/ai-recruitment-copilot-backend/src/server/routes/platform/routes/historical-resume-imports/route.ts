import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { queryPaginatedHistoricalResumeImports, retryHistoricalResumeImports } from "./dao";
import { historicalResumeImportQuerySchema, retryHistoricalResumeImportsSchema } from "./schema";

export const platformHistoricalResumeImportsRouter = factory
  .createApp()
  .get(
    "/",
    zValidator("query", historicalResumeImportQuerySchema, jsonValidatorError("参数校验失败")),
    async (c) => c.json(await queryPaginatedHistoricalResumeImports(c.req.valid("query")), 200),
  )
  .post(
    "/retry-failed",
    zValidator("json", retryHistoricalResumeImportsSchema, jsonValidatorError("参数校验失败")),
    async (c) => c.json(await retryHistoricalResumeImports(c.req.valid("json")), 200),
  );
