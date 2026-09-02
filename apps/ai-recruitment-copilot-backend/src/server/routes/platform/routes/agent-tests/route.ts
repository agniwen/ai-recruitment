import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { getAgentTestsOverview, testAlibabaAgent, testQwenOcrAgent } from "./utils";

export const platformAgentTestsRouter = factory
  .createApp()
  .get("/overview", (c) => c.json(getAgentTestsOverview(), 200))
  .post("/alibaba", async (c) => c.json(await testAlibabaAgent(), 200))
  .post("/qwen-ocr", async (c) => c.json(await testQwenOcrAgent(), 200));
