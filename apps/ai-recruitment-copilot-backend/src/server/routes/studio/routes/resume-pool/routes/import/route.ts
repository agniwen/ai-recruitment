import { zValidator } from "@hono/zod-validator";
import { resumePoolBatchImportSchema } from "@arc/shared/resume-pool";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { batchImportResumePoolItem } from "./dao";

export const resumePoolBatchImportRouter = factory
  .createApp()
  .use(requirePermission("resumePool", "import"))
  .post(
    "/batch",
    zValidator("json", resumePoolBatchImportSchema, jsonValidatorError("入库参数无效。")),
    async (c) => {
      const { activeOrg, user, member } = c.var;
      if (!activeOrg || !user) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      try {
        const result = await batchImportResumePoolItem({
          ...c.req.valid("json"),
          organizationId: activeOrg.id,
          poolItemId: c.req.param("id") ?? "",
          userId: user.id,
          userRole: member?.role,
        });
        return c.json(result, result.status === "imported" ? 201 : 409);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "入库失败。" }, 400);
      }
    },
  );
