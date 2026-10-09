import { zValidator } from "@hono/zod-validator";
import { factory, jsonValidatorError } from "../../../../factory";
import { adminMiddleware } from "../../../../middlewares/admin";
import { listLoggedMeetings, loadMeetingLog } from "./dao";
import { logQuerySchema } from "./schema";

import { interviewMediaRouter } from "./routes/media/route";

const defaultDependencies = { detail: loadMeetingLog, list: listLoggedMeetings };

export function createInterviewLogsRouter(dependencies = defaultDependencies) {
  return factory
    .createApp()
    .use(adminMiddleware)
    .use(async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    })
    .get("/", zValidator("query", logQuerySchema, jsonValidatorError("查询参数无效")), async (c) =>
      c.json(await dependencies.list(c.req.valid("query")), 200),
    )
    .route("/media", interviewMediaRouter)
    .get(
      "/:meetingId",
      zValidator("query", logQuerySchema, jsonValidatorError("查询参数无效")),
      async (c) =>
        c.json(await dependencies.detail(c.req.param("meetingId"), c.req.valid("query")), 200),
    );
}
export const interviewLogsRouter = createInterviewLogsRouter();
