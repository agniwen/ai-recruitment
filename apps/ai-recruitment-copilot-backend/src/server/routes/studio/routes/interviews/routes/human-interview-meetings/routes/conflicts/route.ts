import { zValidator } from "@hono/zod-validator";
import { humanInterviewConflictInputSchema } from "@arc/shared/human-interview-conflicts";
import { factory, jsonValidatorError } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { findHumanInterviewConflicts } from "../../../../dao/human-interview-conflicts";
import { HumanInterviewMeetingError } from "../../../../dao/human-interview-meeting-access";

export const humanInterviewConflictsRouter = factory
  .createApp()
  .post(
    "/",
    requirePermission("humanInterview", "create"),
    zValidator(
      "json",
      humanInterviewConflictInputSchema,
      jsonValidatorError("面试时间检查参数无效。"),
    ),
    async (c) => {
      const { activeOrg } = c.var;
      if (!activeOrg) {
        return c.json({ message: "Unauthorized" }, 401);
      }
      try {
        const conflicts = await findHumanInterviewConflicts({
          input: c.req.valid("json"),
          organizationId: activeOrg.id,
        });
        return c.json({ conflicts }, 200);
      } catch (error) {
        if (error instanceof HumanInterviewMeetingError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    },
  );
