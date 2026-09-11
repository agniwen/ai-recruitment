import { generateStructuredWithMastraAgent } from "../agents/simple-generators";
import type * as ModelsModule from "../models";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
vi.mock("../models", async (importOriginal) => {
  const original = await importOriginal<typeof ModelsModule>();
  return {
    ...original,
    mastraModels: {
      ...original.mastraModels,
      structuredModel: { modelId: "deepseek-v4-flash-0731", providerId: "alibaba" },
    },
  };
});

const schema = z.object({
  name: z.string(),
  nextStep: z.object({ disclaimer: z.literal("以上为初步结论") }),
});
const valid = { name: "测试", nextStep: { disclaimer: "以上为初步结论" } };

describe("Flash text JSON compatibility", () => {
  it("bypasses native structured output for the configured Flash model", async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(valid) });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成评价",
        schema,
        strictJson: true,
      }),
    ).resolves.toEqual(valid);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toContain(
      JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })),
    );
    expect(generate.mock.calls[0][1]).not.toHaveProperty("structuredOutput");
    expect(generate.mock.calls[0][1].providerOptions.alibaba).toEqual({ enable_thinking: false });
  });
  it("retries missing fields once with validation feedback without switching modes", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ name: "测试", nextStep: {} }) })
      .mockResolvedValueOnce({ text: JSON.stringify(valid) });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成评价",
        retryOnInvalid: true,
        schema,
        strictJson: true,
      }),
    ).resolves.toEqual(valid);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toContain("以上为初步结论");
    expect(generate.mock.calls.every((call) => !call[1].structuredOutput)).toBe(true);
  });
  it("does not accept truncated output or repeatedly regenerate invalid results", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ finishReason: "length", text: JSON.stringify(valid) });
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成评价",
        retryOnInvalid: true,
        schema,
        strictJson: true,
      }),
    ).rejects.toThrow("AI 结构化输出被截断");
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("does not retry authentication failures as invalid JSON", async () => {
    const generate = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("unauthorized"), { statusCode: 401 }));
    await expect(
      generateStructuredWithMastraAgent({
        agent: { generate },
        prompt: "生成评价",
        retryOnInvalid: true,
        retryOnTransient: true,
        schema,
      }),
    ).rejects.toThrow("unauthorized");
    expect(generate).toHaveBeenCalledOnce();
  });
});
