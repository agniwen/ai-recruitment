import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import {
  queryInterviewConversationReportByRound,
  queryInterviewConversationReportsByRound,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/interview-conversations";
import { resolvePublicInterviewScope } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/interview-rounds";

export const publicInterviewRoundReportsRouter = factory
  .createApp()
  .get("/", async (c) => {
    const roundId = c.req.param("id");
    if (!roundId) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const scope = await resolvePublicInterviewScope(roundId);
    if (!scope) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const reports = await queryInterviewConversationReportsByRound(scope.roundId);
    return c.json(reports, 200);
  })
  .get("/:conversationId", async (c) => {
    const roundId = c.req.param("id");
    if (!roundId) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const scope = await resolvePublicInterviewScope(roundId);
    if (!scope) {
      return c.json({ error: "记录不存在。" }, 404);
    }
    const report = await queryInterviewConversationReportByRound(
      scope.roundId,
      c.req.param("conversationId"),
    );
    if (!report) {
      return c.json({ error: "面试记录不存在。" }, 404);
    }
    return c.json(report, 200);
  });
