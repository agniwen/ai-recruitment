import { MastraServer } from "@mastra/hono";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { mastra } from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/index";
import { withModelThinkingDisabled } from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/models";

export const platformMastraRouter = factory.createApp();

function withDisabledThinkingInRequestBody(value: unknown, forceProviderOptions: boolean): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const body = value as Record<string, unknown>;
  const modelSettings =
    typeof body.modelSettings === "object" && body.modelSettings !== null
      ? (body.modelSettings as Record<string, unknown>)
      : null;

  return {
    ...body,
    ...((forceProviderOptions || body.providerOptions !== undefined) && {
      providerOptions: withModelThinkingDisabled(body.providerOptions),
    }),
    ...(modelSettings && {
      modelSettings: {
        ...modelSettings,
        providerOptions: withModelThinkingDisabled(modelSettings.providerOptions),
      },
    }),
  };
}

class ThinkingDisabledMastraServer extends MastraServer {
  override async getParams(
    route: Parameters<MastraServer["getParams"]>[0],
    request: Parameters<MastraServer["getParams"]>[1],
  ) {
    const params = await super.getParams(route, request);
    return {
      ...params,
      body: withDisabledThinkingInRequestBody(
        params.body,
        /\/(?:agents|agent-builder)\//.test(route.path),
      ),
    };
  }
}

const server = new ThinkingDisabledMastraServer({
  app: platformMastraRouter,
  mastra,
  prefix: "/",
});

await server.init();
