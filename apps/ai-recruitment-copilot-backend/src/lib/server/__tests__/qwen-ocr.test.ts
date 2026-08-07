import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatCompletionsCreate: vi.fn(),
  openAiConstructor: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      mocks.openAiConstructor(options);
    }

    chat = { completions: { create: mocks.chatCompletionsCreate } };
  },
}));

describe("qwenVlOcr", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.chatCompletionsCreate.mockReset();
    mocks.openAiConstructor.mockReset();
    process.env.ALIBABA_API_KEY = "test-key";
    process.env.QWEN_OCR_BASE_URL = "https://workspace.example.test/compatible-mode/v1";
    process.env.QWEN_OCR_MODEL = "qwen-vl-ocr-latest";
  });

  it("uses the configured Qwen-VL model for page image OCR", async () => {
    mocks.chatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: "逐页 OCR 文本" } }],
    });
    const { isQwenOcrConfigured, qwenVlOcr } = await import("../qwen-ocr");

    expect(isQwenOcrConfigured()).toBe(true);
    await expect(qwenVlOcr(Buffer.from("page"))).resolves.toBe("逐页 OCR 文本");

    expect(mocks.chatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "qwen-vl-ocr-latest" }),
    );
  });

  it("does not require the whole-document qwen3.5-ocr model", async () => {
    process.env.QWEN_OCR_MODEL = "qwen3-vl-flash";
    mocks.chatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: "兼容模型 OCR 文本" } }],
    });
    const { qwenVlOcr } = await import("../qwen-ocr");

    await expect(qwenVlOcr(Buffer.from("page"))).resolves.toBe("兼容模型 OCR 文本");
    expect(mocks.chatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "qwen3-vl-flash" }),
    );
  });

  it("annotates model call failures with model and baseURL", async () => {
    mocks.chatCompletionsCreate.mockRejectedValue(new Error("404 Model not exist."));
    const { qwenVlOcr } = await import("../qwen-ocr");

    await expect(qwenVlOcr(Buffer.from("page"))).rejects.toThrow(
      /model=qwen-vl-ocr-latest.*baseURL=https:\/\/workspace\.example\.test\/compatible-mode\/v1.*404 Model not exist/,
    );
  });

  it("exposes endpoint config without secrets", async () => {
    const { getQwenOcrEndpointConfig } = await import("../qwen-ocr");
    expect(getQwenOcrEndpointConfig()).toEqual({
      baseURL: "https://workspace.example.test/compatible-mode/v1",
      model: "qwen-vl-ocr-latest",
    });
  });
});
