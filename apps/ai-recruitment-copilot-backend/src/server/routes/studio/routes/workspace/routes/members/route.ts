import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  listWorkspaceMemberHierarchy,
  updateWorkspaceMemberDirectManager,
  updateWorkspaceMembersDirectManager,
} from "./dao";
import { memberBatchDirectManagerInputSchema, memberDirectManagerInputSchema } from "./schema";

export const membersRouter = factory
  .createApp()
  .get("/hierarchy", async (c) => {
    const { activeOrg } = c.var;
    if (!activeOrg) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const records = await listWorkspaceMemberHierarchy(activeOrg.id);
    return c.json({ records }, 200);
  })
  .patch(
    "/direct-manager/batch",
    requirePermission("member", "update"),
    zValidator(
      "json",
      memberBatchDirectManagerInputSchema,
      jsonValidatorError("批量直属上级参数无效。"),
    ),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const input = c.req.valid("json");
      const status = await updateWorkspaceMembersDirectManager({
        directManagerUserId: input.directManagerUserId,
        organizationId: activeOrg.id,
        userIds: input.userIds,
      });
      if (status === "missing") {
        return c.json({ error: "成员或直属上级不存在。" }, 404);
      }
      if (status === "self") {
        return c.json({ error: "直属上级不能是已选成员。" }, 400);
      }
      if (status === "cycle") {
        return c.json({ error: "直属上级关系不能形成循环。" }, 409);
      }
      return c.json({ success: true }, 200);
    },
  )
  .patch(
    "/:userId/direct-manager",
    requirePermission("member", "update"),
    zValidator("json", memberDirectManagerInputSchema, jsonValidatorError("直属上级参数无效。")),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const status = await updateWorkspaceMemberDirectManager({
        directManagerUserId: c.req.valid("json").directManagerUserId,
        organizationId: activeOrg.id,
        userId: c.req.param("userId"),
      });
      if (status === "missing") {
        return c.json({ error: "成员或直属上级不存在。" }, 404);
      }
      if (status === "self") {
        return c.json({ error: "成员不能成为自己的直属上级。" }, 400);
      }
      if (status === "cycle") {
        return c.json({ error: "直属上级关系不能形成循环。" }, 409);
      }
      return c.json({ success: true }, 200);
    },
  );
