import { zValidator } from "@hono/zod-validator";
import { revealIpSchema } from "@arc/shared/platform-security";
import { factory, jsonValidatorError } from "../../../../../../factory";
import { adminMiddleware } from "../../../../../../middlewares/admin";
import { platformMfaMiddleware } from "../../../../../../middlewares/platform-mfa";
import { SecurityError, securityPrincipal } from "../../../../../security/mfa/service";
import { revealStoredIp } from "./dao";

export function createIpRouter(reveal = revealStoredIp) {
  return factory
    .createApp()
    .use(adminMiddleware)
    .use(platformMfaMiddleware)
    .post(
      "/reveal",
      zValidator("json", revealIpSchema, jsonValidatorError("IP 记录无效")),
      async (c) => {
        c.header("Referrer-Policy", "no-referrer");
        try {
          const result = await reveal(
            c.req.valid("json"),
            securityPrincipal(c.var),
            c.req.raw.headers,
          );
          return result ? c.json(result, 200) : c.json({ message: "未找到 IP 记录。" }, 404);
        } catch (error) {
          if (error instanceof SecurityError) {
            return c.json({ code: error.code, message: error.message }, error.status);
          }
          return c.json(
            { message: "暂时无法查看 IP，请联系维护人员检查密钥和历史数据迁移。" },
            503,
          );
        }
      },
    );
}
export const ipRouter = createIpRouter();
