import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  generateStructuredWithMastraAgent,
  generateTextWithMastraAgent,
} from "@arc/ai-recruitment-copilot-backend/server/agents/mastra/agents/simple-generators";

describe("simple Mastra generators", () => {
  it("generates text with model settings", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "标题" });

    await expect(
      generateTextWithMastraAgent({
        agent: { generate },
        prompt: "生成标题",
        temperature: 0.2,
      }),
    ).resolves.toBe("标题");

    expect(generate).toHaveBeenCalledWith(
      "生成标题",
      expect.objectContaining({
        modelSettings: { temperature: 0.2 },
      }),
    );
  });

  it("generates structured output with the original Zod schema", async () => {
    const schema = z.object({ title: z.string().min(1) });
    const generate = vi.fn().mockResolvedValue({ object: { title: "前端工程师" }, text: "" });

    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成结构化对象",
        schema,
        temperature: 0.3,
      }),
    ).resolves.toEqual({ title: "前端工程师" });

    expect(generate).toHaveBeenCalledWith(
      "生成结构化对象",
      expect.objectContaining({
        modelSettings: { temperature: 0.3 },
        structuredOutput: { schema },
      }),
    );
  });

  it("recovers a valid structured object from fenced model text", async () => {
    const generate = vi.fn().mockResolvedValue({
      object: undefined,
      text: '```json\n{"title":"前端工程师"}\n```',
    });

    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成结构化对象",
        schema: z.object({ title: z.string().min(1) }),
      }),
    ).resolves.toEqual({ title: "前端工程师" });

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries once with validation feedback after an invalid structured object", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ object: { title: "" }, text: "" })
      .mockResolvedValueOnce({ object: { title: "前端工程师" }, text: "" });

    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成结构化对象",
        retryOnInvalid: true,
        schema: z.object({ title: z.string().min(1, "标题不能为空") }),
      }),
    ).resolves.toEqual({ title: "前端工程师" });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toContain("标题不能为空");
    expect(generate.mock.calls[1]?.[0]).toContain("重新输出完整的 JSON 对象");
  });

  it("retries once when the structured provider returns an error result", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error("invalid structured output"), text: "" })
      .mockResolvedValueOnce({ object: { title: "前端工程师" }, text: "" });

    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成结构化对象",
        retryOnInvalid: true,
        schema: z.object({ title: z.string().min(1) }),
      }),
    ).resolves.toEqual({ title: "前端工程师" });

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    { object: { title: 123 }, text: '{"title":123}' },
    { error: new Error("provider validation failed"), text: '{"title":' },
  ])("retains the rejected model response with the validation error", async (result) => {
    const generate = vi.fn().mockResolvedValue(result);
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "解析简历",
        schema: z.object({ title: z.string() }),
      }),
    ).rejects.toMatchObject({
      modelResponse: {
        text: result.text,
        ...("object" in result ? { objectJson: JSON.stringify(result.object) } : {}),
      },
    });
  });

  it("throws the first schema validation message", async () => {
    const generate = vi.fn().mockResolvedValue({ object: { title: "" }, text: "" });

    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成结构化对象",
        schema: z.object({ title: z.string().min(1, "标题不能为空") }),
      }),
    ).rejects.toThrow("标题不能为空");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("resume structured generation recovery", () => {
  const schema = z.object({ name: z.string().nullable() });
  it("retries a thrown transient error before using the next valid result", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { statusCode: 429 }))
      .mockResolvedValueOnce({ object: { name: "张三" }, text: "" });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "解析",
        retryOnTransient: true,
        schema,
      }),
    ).resolves.toEqual({ name: "张三" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("falls back to text JSON when native structured output is unsupported", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("response_format json_schema is not supported"))
      .mockResolvedValueOnce({ text: '{"name":"张三"}' });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        fallbackToTextGeneration: true,
        prompt: "解析",
        schema,
        strictJson: true,
      }),
    ).resolves.toEqual({ name: "张三" });
    expect(generate.mock.calls[1]?.[1]).not.toHaveProperty("structuredOutput");
  });

  it.each([
    '{"name":"张三","work":{}} trailing',
    '[{"name":"张三"}]',
    '{"name":"张三","work":{"name":"李四"}',
  ])("does not accept a nested object from malformed or non-object JSON (%s)", async (text) => {
    const generate = vi.fn().mockResolvedValue({ text });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "解析",
        schema,
        strictJson: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects truncated output even if the provider also returns a usable object", async () => {
    const generate = vi.fn().mockResolvedValue({
      finishReason: "length",
      object: { name: "张三" },
      text: '{"name":"张三"}',
    });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "解析",
        schema,
        strictJson: true,
      }),
    ).rejects.toThrow();
  });

  it("does not hide authentication errors behind a text fallback", async () => {
    const error = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const generate = vi.fn().mockRejectedValue(error);
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        fallbackToTextGeneration: true,
        prompt: "解析",
        retryOnInvalid: true,
        retryOnTransient: true,
        schema,
      }),
    ).rejects.toThrow("Unauthorized");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
