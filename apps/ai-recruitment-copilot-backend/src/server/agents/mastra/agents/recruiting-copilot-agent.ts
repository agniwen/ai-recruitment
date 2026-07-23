import { Agent } from "@mastra/core/agent";
import type { RecruitingVisibilityScope } from "@arc/ai-recruitment-copilot-backend/server/access/recruiting-visibility";
import type { WorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { mastraModels } from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/models";
import { createRecruitingCopilotTools } from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/tools/recruiting-copilot";
import type { ChatContextBindings } from "@arc/db-schema/chat-context-bindings";
import { EMPTY_CHAT_CONTEXT_BINDINGS } from "@arc/db-schema/chat-context-bindings";
import { buildRecruitingCopilotInstructions } from "./recruiting-copilot-instructions";
import type { RecruitingCopilotFocus } from "./recruiting-copilot-instructions";

export function createRecruitingCopilotAgent({
  authorize,
  contextBindings = EMPTY_CHAT_CONTEXT_BINDINGS,
  conversationId,
  focus,
  organizationId,
  userId,
  visibilityScope,
}: {
  authorize: WorkspaceAuthorizer;
  contextBindings?: ChatContextBindings;
  conversationId?: string | null;
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
    tools: createRecruitingCopilotTools({
      authorize,
      contextBindings,
      conversationId,
      organizationId,
      userId,
      visibilityScope,
    }),
  });
}
