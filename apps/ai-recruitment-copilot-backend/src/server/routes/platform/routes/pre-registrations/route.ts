import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  createPlatformPreRegistration,
  deletePlatformPreRegistration,
  listPlatformPreRegistrationManagerOptions,
  queryPaginatedPlatformPreRegistrations,
  updatePlatformPreRegistration,
} from "./dao";
import { provisionPreRegisteredUserByEmail } from "./provisioning";
import { platformPreRegistrationInputSchema, platformPreRegistrationsQuerySchema } from "./schema";

function mutationErrorResponse(
  c: Context,
  result: "cycle" | "duplicate" | "manager_not_found" | "not_found",
) {
  if (result === "not_found" || result === "manager_not_found") {
    return c.json(
      { error: result === "not_found" ? "预录入信息不存在。" : "直属上级不存在。" },
      404,
    );
  }
  if (result === "duplicate") {
    return c.json({ error: "该邮箱已存在预录入信息。" }, 409);
  }
  return c.json({ error: "直属上级关系不能形成循环。" }, 409);
}

export const platformPreRegistrationsRouter = factory
  .createApp()
  .get(
    "/",
    zValidator("query", platformPreRegistrationsQuerySchema, jsonValidatorError("参数校验失败")),
    async (c) => {
      const result = await queryPaginatedPlatformPreRegistrations(c.req.valid("query"));
      return c.json(result, 200);
    },
  )
  .get("/manager-options", async (c) => {
    const records = await listPlatformPreRegistrationManagerOptions();
    return c.json({ records }, 200);
  })
  .post(
    "/",
    zValidator("json", platformPreRegistrationInputSchema, jsonValidatorError("预录入信息无效。")),
    async (c) => {
      const result = await createPlatformPreRegistration(c.req.valid("json"));
      if (typeof result === "string") {
        return mutationErrorResponse(c, result);
      }
      await provisionPreRegisteredUserByEmail(result.email);
      return c.json({ id: result.id }, 201);
    },
  )
  .patch(
    "/:id",
    zValidator("json", platformPreRegistrationInputSchema, jsonValidatorError("预录入信息无效。")),
    async (c) => {
      const result = await updatePlatformPreRegistration(c.req.param("id"), c.req.valid("json"));
      if (typeof result === "string") {
        return mutationErrorResponse(c, result);
      }
      await provisionPreRegisteredUserByEmail(result.email);
      return c.json({ id: result.id }, 200);
    },
  )
  .delete("/:id", async (c) => {
    const deleted = await deletePlatformPreRegistration(c.req.param("id"));
    if (!deleted) {
      return c.json({ error: "预录入信息不存在。" }, 404);
    }
    return c.json({ success: true }, 200);
  });
