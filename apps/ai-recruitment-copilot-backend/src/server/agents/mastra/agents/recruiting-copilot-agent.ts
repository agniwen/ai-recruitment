import { Agent } from "@mastra/core/agent";
import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { WorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { mastraModels } from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/models";
import { createRecruitingCopilotTools } from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/tools/recruiting-copilot";
import { buildRecruitingCopilotInstructions } from "./recruiting-copilot-instructions";
import type { RecruitingCopilotFocus } from "./recruiting-copilot-instructions";

export function createRecruitingCopilotAgent({
  authorize,
  focus,
  organizationId,
  userId,
  visibilityScope,
}: {
  authorize: WorkspaceAuthorizer;
  focus?: RecruitingCopilotFocus;
  organizationId: string;
  userId: string;
  visibilityScope: RecruitingVisibilityScope;
}) {
  return new Agent({
    id: "recruiting-copilot-agent",
    instructions: buildRecruitingCopilotInstructions(focus),
    maxRetries: 1,
    model: mastraModels.fastModel,
    name: "RecruitingCopilotAgent",
    tools: createRecruitingCopilotTools({ authorize, organizationId, userId, visibilityScope }),
  });
}
