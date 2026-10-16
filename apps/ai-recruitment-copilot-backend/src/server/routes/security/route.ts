import { getRequiredEnv } from "@arc/ai-recruitment-copilot-backend/lib/server/env";
import { zValidator } from "@hono/zod-validator";
import { setCookie } from "hono/cookie";
import {
  mfaActivitySchema,
  mfaCodeSchema,
  mfaReplacementCodeSchema,
} from "@arc/shared/platform-security";
import { factory, jsonValidatorError } from "../../factory";
import { adminMiddleware } from "../../middlewares/admin";
import {
  beginMfaEnrollment,
  getMfaStatus,
  renewMfaActivity,
  SecurityError,
  securityPrincipal,
  verifyMfa,
} from "./mfa/service";
import { MFA_COOKIE, MFA_COOKIE_OPTIONS } from "./mfa/policy";
import { beginMfaReplacement, confirmMfaReplacement } from "./mfa/replacement";

export const securityRouter = factory
  .createApp()
  .use(adminMiddleware)
  .use(async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    if (
      c.req.method !== "GET" &&
      c.req.header("origin") !== new URL(getRequiredEnv("BETTER_AUTH_URL")).origin
    ) {
      return c.json({ message: "请求来源无效。" }, 403);
    }
    if (!c.var.session) {
      return c.json({ message: "请先登录。" }, 401);
    }
    await next();
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Hono error-handler registration requires a callback.
  .onError((error, c) =>
    error instanceof SecurityError
      ? c.json({ code: error.code, message: error.message }, error.status)
      : c.json({ code: "SECURITY_UNAVAILABLE", message: "安全验证暂时不可用，请稍后重试。" }, 503),
  )
  .get("/mfa", async (c) =>
    c.json(await getMfaStatus(securityPrincipal(c.var), c.req.raw.headers), 200),
  )
  .post("/mfa/enroll", async (c) => c.json(await beginMfaEnrollment(securityPrincipal(c.var)), 200))
  .post(
    "/mfa/activity",
    zValidator("json", mfaActivitySchema, jsonValidatorError("活动时间无效")),
    async (c) => {
      const { token, expiresAt } = await renewMfaActivity(
        securityPrincipal(c.var),
        c.req.raw.headers,
        c.req.valid("json").activeAt,
      );
      setCookie(c, MFA_COOKIE, token, {
        ...MFA_COOKIE_OPTIONS,
        maxAge: Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)),
      });
      return c.json({ expiresAt }, 200);
    },
  )
  .post(
    "/mfa/verify",
    zValidator("json", mfaCodeSchema, jsonValidatorError("验证码格式无效")),
    async (c) => {
      const { token, ...result } = await verifyMfa(securityPrincipal(c.var), c.req.valid("json"));
      setCookie(c, MFA_COOKIE, token, MFA_COOKIE_OPTIONS);
      return c.json(result, 200);
    },
  )
  .post("/mfa/replacement", async (c) =>
    c.json(await beginMfaReplacement(securityPrincipal(c.var), c.req.raw.headers), 200),
  )
  .post(
    "/mfa/replacement/verify",
    zValidator("json", mfaReplacementCodeSchema, jsonValidatorError("请输入新验证器的六位验证码")),
    async (c) => {
      const { token, ...result } = await confirmMfaReplacement(
        securityPrincipal(c.var),
        c.req.raw.headers,
        c.req.valid("json").code,
      );
      setCookie(c, MFA_COOKIE, token, MFA_COOKIE_OPTIONS);
      return c.json(result, 200);
    },
  );
