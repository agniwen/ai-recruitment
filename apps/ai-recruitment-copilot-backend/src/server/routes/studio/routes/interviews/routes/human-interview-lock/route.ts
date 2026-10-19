import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { requirePermission } from "@arc/ai-recruitment-copilot-backend/server/middlewares/permission";
import { findHumanInterviewCandidateLock } from "../../dao/human-interview-candidate-lock";

export const humanInterviewLockRouter = factory
  .createApp()
  .get("/", requirePermission("humanInterview", "create"), async (c) => {
    c.header("Cache-Control", "no-store");
    if (!c.var.activeOrg) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const lock = await findHumanInterviewCandidateLock({
      interviewRecordId: c.req.param("id") ?? "",
      organizationId: c.var.activeOrg.id,
    });
    return c.json({ lock }, 200);
  });
