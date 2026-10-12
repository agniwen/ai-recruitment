import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import {
  entryCredentialOptionsSchema,
  entryCredentialVerificationSchema,
} from "@arc/shared/entry-credentials";
import { factory, jsonValidatorError } from "../../../../factory";
import { resolveHumanInterviewMeetingInviteToken } from "../../../studio/routes/interviews/dao/human-interview-meetings";
import { getHumanInterviewMeetingEntryAccess } from "../../../studio/routes/interviews/dao/human-interview-meeting-access";
import { entryRelyingParty, getCandidateEntryPolicy } from "./policy";
import { createEntryOptions, recordCredentialEvent, verifyEntryCredential } from "./service";
import { createTelemetryLimiter } from "../interview-telemetry/utils";

const limit = createTelemetryLimiter();
export const entryCredentialsRouter = factory
  .createApp()
  .use(bodyLimit({ maxSize: 100_000 }))
  .use(async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!limit(c.req.param("inviteToken") ?? "")) {
      return c.json({ error: "操作过于频繁，请稍后重试。" }, 429);
    }
    try {
      if (c.req.header("Origin") !== entryRelyingParty().origin) {
        return c.json({ error: "请从面试页面发起验证。" }, 403);
      }
    } catch {
      return c.json({ error: "入场凭据服务配置异常，请联系 HR。" }, 503);
    }
    await next();
  })
  .post(
    "/options",
    zValidator("json", entryCredentialOptionsSchema, jsonValidatorError("验证参数无效")),
    async (c) => {
      const invite = c.req.param("inviteToken") ?? "";
      const scope = await resolveHumanInterviewMeetingInviteToken(invite);
      if (!scope) {
        return c.json({ error: "面试链接不可用。" }, 404);
      }
      if (!getHumanInterviewMeetingEntryAccess(scope).canJoin) {
        return c.json({ error: "当前不可入会。" }, 403);
      }
      const policy = await getCandidateEntryPolicy(scope);
      if (!policy.required) {
        return c.json({ error: "已无需验证，请关闭提示后重新进入面试。" }, 409);
      }
      try {
        return c.json(
          await createEntryOptions(scope, invite, c.req.raw.headers, c.req.valid("json").kind),
          200,
        );
      } catch {
        return c.json({ error: "无法发起凭据验证，请重试或联系 HR。" }, 400);
      }
    },
  )
  .post(
    "/verify",
    zValidator("json", entryCredentialVerificationSchema, jsonValidatorError("凭据响应无效")),
    async (c) => {
      const invite = c.req.param("inviteToken") ?? "";
      const scope = await resolveHumanInterviewMeetingInviteToken(invite);
      if (!scope) {
        return c.json({ error: "面试链接不可用。" }, 404);
      }
      if (!getHumanInterviewMeetingEntryAccess(scope).canJoin) {
        return c.json({ error: "当前不可入会。" }, 403);
      }
      const policy = await getCandidateEntryPolicy(scope);
      if (!policy.required) {
        return c.json({ error: "已无需验证，请关闭提示后重新进入面试。" }, 409);
      }
      try {
        return c.json(
          await verifyEntryCredential(scope, invite, c.req.raw.headers, c.req.valid("json")),
          200,
        );
      } catch {
        await recordCredentialEvent(scope, c.req.raw.headers, "entry_credential_failed", {
          reason: "verification_failed",
        });
        return c.json(
          { error: "凭据验证未通过或已过期，请重新验证；仍无法进入时请联系 HR。" },
          400,
        );
      }
    },
  );
