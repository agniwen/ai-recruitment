import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { humanInterviewConflictsRouter } from "./routes/conflicts/route";

export const humanInterviewMeetingsRouter = factory
  .createApp()
  .route("/conflicts", humanInterviewConflictsRouter);
