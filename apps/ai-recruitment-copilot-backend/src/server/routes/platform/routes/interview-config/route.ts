import { zValidator } from "@hono/zod-validator";
import { platformInterviewConfigSchema } from "@arc/shared/platform-interview-config";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { loadPlatformInterviewConfig, savePlatformInterviewConfig } from "./dao";

export const platformInterviewConfigRouter = factory
  .createApp()
  .get("/", async (c) => c.json(await loadPlatformInterviewConfig(), 200))
  .put(
    "/",
    zValidator(
      "json",
      platformInterviewConfigSchema,
      jsonValidatorError("请输入 1–8760 的整数小时"),
    ),
    async (c) => c.json(await savePlatformInterviewConfig(c.req.valid("json")), 200),
  );
