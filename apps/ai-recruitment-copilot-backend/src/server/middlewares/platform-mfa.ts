import { getRequiredEnv } from "@arc/ai-recruitment-copilot-backend/lib/server/env";
import { factory } from "../factory";
import { requireRecentMfa, SecurityError } from "../routes/security/mfa/service";

export const platformMfaMiddleware = factory.createMiddleware(async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    c.req.header("origin") !== new URL(getRequiredEnv("BETTER_AUTH_URL")).origin
  ) {
    return c.json({ code: "INVALID_ORIGIN", message: "请求来源无效。" }, 403);
  }
  if (!c.var.user || !c.var.session) {
    return c.json({ code: "UNAUTHORIZED", message: "请先登录。" }, 401);
  }
  try {
    await requireRecentMfa(
      { sessionId: c.var.session.id, userId: c.var.user.id },
      c.req.raw.headers,
    );
  } catch (error) {
    if (error instanceof SecurityError) {
      return c.json({ code: error.code, message: error.message }, error.status);
    }
    return c.json(
      { code: "SECURITY_UNAVAILABLE", message: "暂时无法验证后台权限，请稍后重试。" },
      503,
    );
  }
  return next();
});
