import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { interviewEventBatchSchema } from "@arc/shared/interview-telemetry";
import { factory, jsonValidatorError } from "../../../../factory";
import { resolveTelemetryScope, saveClientEvents } from "./dao";
import { createTelemetryLimiter } from "./utils";

export function createInterviewTelemetryRouter(
  overrides: Partial<{
    resolve: typeof resolveTelemetryScope;
    save: typeof saveClientEvents;
  }> = {},
) {
  const resolve = overrides.resolve ?? resolveTelemetryScope;
  const save = overrides.save ?? saveClientEvents;
  const allow = createTelemetryLimiter();
  return factory
    .createApp()
    .use(bodyLimit({ maxSize: 32_768, onError: (c) => c.json({ error: "日志批次过大" }, 413) }))
    .post(
      "/",
      zValidator("json", interviewEventBatchSchema, jsonValidatorError("日志格式无效")),
      async (c) => {
        const token = c.req.header("Authorization")?.match(/^Bearer (.{1,4096})$/)?.[1];
        if (!token) {
          return c.json({ error: "邀请凭证无效" }, 401);
        }
        if (!allow(token)) {
          return c.json({ error: "日志上报过于频繁" }, 429);
        }
        const { mode, events } = c.req.valid("json");
        const scope = await resolve(mode, token);
        if (!scope) {
          return c.json({ error: "邀请凭证无效" }, 401);
        }
        try {
          await save(scope, events, c.req.raw.headers);
          return c.json({ accepted: events.length }, 200);
        } catch {
          return c.json({ error: "日志暂时无法保存" }, 503);
        }
      },
    );
}

export const interviewTelemetryRouter = createInterviewTelemetryRouter();
