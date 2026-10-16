import { Agent } from "@mastra/core/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateStructuredWithMastraAgent } from "../agents/simple-generators";
import { withOpenRouterFallback, withThinkingDisabled } from "../models";
import { createJobMatchingExtractionSchema } from "../../../routes/studio/routes/job-descriptions/utils/matching-profile";

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

const primaryModel = {
  apiKey: "primary-test-key",
  modelId: "deepseek-v4-flash-0731",
  providerId: "alibaba",
  url: "https://primary.invalid/v1",
};
const fallbackEnv = {
  OPENROUTER_API_KEY: "backup-test-key",
  OPENROUTER_BASE_URL: "https://backup.invalid/api/v1/",
  OPENROUTER_FALLBACK_MODEL: "x-ai/grok-4.7",
};
const source = "前端开发，要求 React";
const output = {
  profile: {
    domains: [],
    minimumEducation: null,
    minimumWorkYears: null,
    preferredSkills: [],
    requiredSkills: ["React"],
    responsibilities: [],
    roleFamily: "前端开发",
    seniority: "",
  },
  sources: [
    { field: "roleFamily", quote: "前端开发" },
    { field: "requiredSkills", quote: "React" },
  ],
};

function mockModelRequests({
  primaryStatus = 400,
  backupStatus = 200,
  backupOutput = output,
} = {}) {
  const requests: { authorization: string | null; body: Record<string, unknown>; url: string }[] =
    [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: unknown, init: RequestInit) => {
      const isPrimary = String(url).startsWith(primaryModel.url);
      requests.push({
        authorization: new Headers(init.headers).get("authorization"),
        body: JSON.parse(String(init.body)),
        url: String(url),
      });
      const status = isPrimary ? primaryStatus : backupStatus;
      if (status !== 200) {
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: isPrimary ? "DataInspectionFailed" : "backup_unavailable",
                message: isPrimary
                  ? "Output data may contain inappropriate content."
                  : "Unavailable",
                type: "api_error",
              },
            },
            { status },
          ),
        );
      }
      return Promise.resolve(
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: {
                content: JSON.stringify(isPrimary ? output : backupOutput),
                role: "assistant",
              },
            },
          ],
          created: 1,
          id: "offline-fallback-test",
          model: isPrimary ? primaryModel.modelId : "x-ai/grok-4.7",
          object: "chat.completion",
          usage: { completion_tokens: 50, prompt_tokens: 100, total_tokens: 150 },
        }),
      );
    }),
  );
  return requests;
}

function generateProfile() {
  const agent = new Agent({
    id: "fallback-contract-test",
    instructions: "Extract job requirements with verbatim evidence.",
    maxRetries: 1,
    model: withOpenRouterFallback(primaryModel, fallbackEnv),
    name: "FallbackContractTest",
  });
  return generateStructuredWithMastraAgent({
    agent,
    prompt: source,
    schema: createJobMatchingExtractionSchema(source),
    strictJson: true,
    textGenerationFirst: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenRouter job-profile model fallback", () => {
  it("preserves the existing single-model behavior without a backup key", () => {
    expect(withOpenRouterFallback(primaryModel, {})).toEqual(withThinkingDisabled(primaryModel));
    expect(withOpenRouterFallback(primaryModel, { OPENROUTER_API_KEY: " " })).toEqual(
      withThinkingDisabled(primaryModel),
    );
  });

  it("defaults to the verified Grok model and the OpenRouter API base", () => {
    const models = withOpenRouterFallback(primaryModel, { OPENROUTER_API_KEY: "test-key" });
    expect(models).toHaveLength(2);
    expect(models[1]?.model).toEqual({
      apiKey: "test-key",
      modelId: "x-ai/grok-4.7",
      providerId: "openrouter",
      url: "https://openrouter.ai/api/v1",
    });
  });

  it("uses only the primary provider when it succeeds", async () => {
    const requests = mockModelRequests({ primaryStatus: 200 });
    await expect(generateProfile()).resolves.toEqual(output);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://primary.invalid/v1/chat/completions");
  });

  it.each([400, 429, 503])("switches providers after a primary HTTP %s failure", async (status) => {
    const requests = mockModelRequests({ primaryStatus: status });
    await expect(generateProfile()).resolves.toEqual(output);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      authorization: "Bearer backup-test-key",
      body: { model: "x-ai/grok-4.7", reasoning: { effort: "low", exclude: true } },
      url: "https://backup.invalid/api/v1/chat/completions",
    });
    expect(requests[0]?.authorization).toBe("Bearer primary-test-key");
    expect(requests[1]?.body.reasoning_effort).not.toBe("none");
  });

  it("switches providers after a primary network failure", async () => {
    const requests = mockModelRequests();
    vi.mocked(fetch).mockImplementationOnce(() => Promise.reject(new Error("connect ETIMEDOUT")));
    await expect(generateProfile()).resolves.toEqual(output);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requests[0]?.body.model).toBe("x-ai/grok-4.7");
  });

  it("keeps the original source-evidence validation for backup output", async () => {
    const requests = mockModelRequests({
      backupOutput: { ...output, sources: [{ field: "roleFamily", quote: "编造的岗位原文" }] },
    });
    await expect(generateProfile()).rejects.toThrow("引用不在原文");
    expect(requests).toHaveLength(2);
  });

  it("surfaces failure after both providers fail without cycling through them again", async () => {
    const requests = mockModelRequests({ backupStatus: 503 });
    await expect(generateProfile()).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });
});
