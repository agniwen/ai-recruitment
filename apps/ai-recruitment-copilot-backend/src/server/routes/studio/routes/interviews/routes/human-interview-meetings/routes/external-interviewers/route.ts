import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { externalInterviewerInputSchema } from "@arc/db-schema/studio-interviews";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import {
  loadExternalInterviewerDefaults,
  resolveExternalInterviewerBindings,
} from "../../../../dao/external-interviewers";

export const externalInterviewersRouter = factory
  .createApp()
  .use("*", requirePermission("humanInterview", "create"))
  .get(
    "/",
    zValidator(
      "query",
      z.object({ candidateId: z.string().min(1) }),
      jsonValidatorError("候选人参数无效"),
    ),
    async (c) => {
      const org = c.var.activeOrg;
      if (!org) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const defaults = await loadExternalInterviewerDefaults(
        c.req.valid("query").candidateId,
        org.id,
      );
      if (!defaults) {
        return c.json({ error: "候选人不存在" }, 404);
      }
      return c.json(defaults, 200);
    },
  )
  .post(
    "/check",
    zValidator(
      "json",
      z.object({ interviewers: z.array(externalInterviewerInputSchema).max(20) }),
      jsonValidatorError("外部面试官信息无效"),
    ),
    async (c) => {
      const org = c.var.activeOrg;
      if (!org) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      const results = await resolveExternalInterviewerBindings(
        org.id,
        c.req.valid("json").interviewers,
      );
      return c.json(
        results.map(({ name, telegram, chatId }) => ({ bound: Boolean(chatId), name, telegram })),
        200,
      );
    },
  );
