import { zValidator } from "@hono/zod-validator";
import { globalConfigSchema, resumeProtectionConfigSchema } from "@arc/shared/global-config";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  saveResumeProtectionDays,
  getGlobalConfig,
  upsertGlobalConfig,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/global-config/dao";

export const globalConfigRouter = factory
  .createApp()
  .get("/", requirePermission("globalConfig", "read"), async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const record = await getGlobalConfig(activeOrg.id);
    return c.json(record, 200);
  })
  .put(
    "/resume-protection",
    requirePermission("globalConfig", "update"),
    zValidator("json", resumeProtectionConfigSchema, jsonValidatorError("保护期天数无效。")),
    async (c) => {
      const { activeOrg, user } = c.var;
      if (!activeOrg || !user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const result = await saveResumeProtectionDays(
        activeOrg.id,
        user.id,
        c.req.valid("json").days,
      );
      return c.json({ ...result, resumeProtectionUpdatedByName: user.name }, 200);
    },
  )
  .put(
    "/",
    requirePermission("globalConfig", "update"),
    zValidator("json", globalConfigSchema, jsonValidatorError("表单校验失败。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const record = await upsertGlobalConfig(input, c.var.user?.id ?? null, activeOrg.id);
      return c.json(record, 200);
    },
  );
