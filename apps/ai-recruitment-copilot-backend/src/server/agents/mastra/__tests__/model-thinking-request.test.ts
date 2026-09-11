import { generateText } from "ai";
import { createAlibabaProvider } from "../../provider";
import { Agent } from "@mastra/core/agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateTextWithMastraAgent,
  streamTextWithMastraAgent,
} from "../agents/simple-generators";
import { withThinkingDisabled } from "../models";
import { withModelThinkingDisabled } from "@arc/shared/model-thinking";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Alibaba thinking request contract", () => {
  it("sends enable_thinking=false through the actual Mastra provider", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          Response.json({
            choices: [
              { finish_reason: "stop", index: 0, message: { content: "完成", role: "assistant" } },
            ],
            created: 1,
            id: "offline-test",
            model: "deepseek-v4-flash-0731",
            object: "chat.completion",
            usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
          }),
        );
      }),
    );
    const agent = new Agent({
      id: "thinking-contract-test",
      instructions: "Return a short answer.",
      maxRetries: 0,
      model: {
        apiKey: "offline-test",
        modelId: "deepseek-v4-flash-0731",
        providerId: "alibaba",
        url: "https://offline.invalid/v1",
      },
      name: "thinking-contract-test",
    });
    await expect(generateTextWithMastraAgent({ agent, prompt: "测试" })).resolves.toBe("完成");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty("enable_thinking", false);
    expect(requests[0]).not.toHaveProperty("enableThinking");
  });

  it.each(["alibaba", "alibaba-coding-plan"])(
    "disables thinking for direct %s agent generation and streaming",
    async (providerId) => {
      vi.stubEnv("ALIBABA_CODING_PLAN_API_KEY", "offline-test");
      const requests: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: unknown, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          requests.push(body);
          const base = { created: 1, id: "offline-test", model: "qwen3.5-plus" };
          if (body.stream) {
            const chunk = {
              ...base,
              choices: [
                { delta: { content: "完成", role: "assistant" }, finish_reason: "stop", index: 0 },
              ],
              object: "chat.completion.chunk",
            };
            return Promise.resolve(
              new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
                headers: { "content-type": "text/event-stream" },
              }),
            );
          }
          return Promise.resolve(
            Response.json({
              ...base,
              choices: [
                {
                  finish_reason: "stop",
                  index: 0,
                  message: { content: "完成", role: "assistant" },
                },
              ],
              object: "chat.completion",
              usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
            }),
          );
        }),
      );
      const agent = new Agent({
        id: "direct-thinking-test",
        instructions: "Return a short answer.",
        maxRetries: 0,
        model: withThinkingDisabled(
          providerId === "alibaba"
            ? {
                apiKey: "offline-test",
                modelId: "qwen3.5-plus",
                providerId,
                url: "https://offline.invalid/v1",
              }
            : "alibaba-coding-plan/qwen3.5-plus",
        ),
        name: "direct-thinking-test",
      });
      const result = await agent.generate("测试");
      expect(result.text).toBe("完成");
      const stream = await agent.stream("测试");
      expect(await stream.text).toBe("完成");
      expect(await generateTextWithMastraAgent({ agent, prompt: "测试" })).toBe("完成");
      let streamedText = "";
      for await (const chunk of streamTextWithMastraAgent({ agent, prompt: "测试" })) {
        streamedText += chunk;
      }
      expect(streamedText).toBe("完成");
      expect(requests).toHaveLength(4);
      for (const body of requests) {
        expect(body).toHaveProperty("enable_thinking", false);
        expect(body).not.toHaveProperty("enableThinking");
      }
    },
  );

  it("forces thinking off in the AI SDK provider even when a caller enables it", async () => {
    vi.stubEnv("ALIBABA_API_KEY", "offline-test");
    vi.stubEnv("ALIBABA_BASE_URL", "https://offline.invalid/v1");
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init: RequestInit) => {
        requests.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          Response.json({
            choices: [
              { finish_reason: "stop", index: 0, message: { content: "完成", role: "assistant" } },
            ],
            created: 1,
            id: "offline-test",
            model: "qwen3.5-plus",
            usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
          }),
        );
      }),
    );
    await generateText({
      model: createAlibabaProvider()("qwen3.5-plus"),
      prompt: "测试",
      providerOptions: { alibaba: { enable_thinking: true } },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty("enable_thinking", false);
    expect(requests[0]).not.toHaveProperty("enableThinking");
  });

  it("overrides enabled thinking while preserving other provider settings", () => {
    expect(
      withModelThinkingDisabled({ alibaba: { custom: "keep", enable_thinking: true } }).alibaba,
    ).toEqual({ custom: "keep", enable_thinking: false });
  });
});
