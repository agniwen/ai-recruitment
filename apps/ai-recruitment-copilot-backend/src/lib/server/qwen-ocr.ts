// Qwen-VL OCR via DashScope (OpenAI-compatible mode).
// Used as visual fallback for image-based PDF resumes.

import OpenAI from "openai";
import { getRequiredEnv } from "./env";

const OCR_PROMPT =
  "请完整提取这张简历图片中的所有文字，包括所有图片、图表、表格中的文字。保持原始排版顺序，表格用文字形式还原。只输出提取的文字，不要解释。";
const DEFAULT_QWEN_OCR_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const OCR_LOG_PREFIX = "[resume-ocr]";

let cachedClient: OpenAI | null = null;
let cachedClientKey: string | null = null;

export interface QwenOcrEndpointConfig {
  baseURL: string;
  model: string;
}

export function getQwenOcrEndpointConfig(
  env: NodeJS.ProcessEnv = process.env,
): QwenOcrEndpointConfig {
  return {
    baseURL: env.QWEN_OCR_BASE_URL?.trim() || DEFAULT_QWEN_OCR_BASE_URL,
    model: env.QWEN_OCR_MODEL?.trim() || "(QWEN_OCR_MODEL unset)",
  };
}

function getClient(baseURL: string): OpenAI {
  const apiKey = process.env.ALIBABA_API_KEY;
  if (!apiKey) {
    throw new Error("ALIBABA_API_KEY is not configured; cannot run Qwen OCR.");
  }
  const cacheKey = `${baseURL}\0${apiKey}`;
  if (cachedClient && cachedClientKey === cacheKey) {
    return cachedClient;
  }
  cachedClient = new OpenAI({
    apiKey,
    baseURL,
  });
  cachedClientKey = cacheKey;
  return cachedClient;
}

export function isQwenOcrConfigured(): boolean {
  return Boolean(process.env.ALIBABA_API_KEY);
}

function formatOcrErrorMessage(config: QwenOcrEndpointConfig, message: string): string {
  return `Qwen OCR failed (model=${config.model}, baseURL=${config.baseURL}): ${message}`;
}

export async function qwenVlOcr(imageBytes: Buffer, mediaType = "image/png"): Promise<string> {
  const config = getQwenOcrEndpointConfig();
  // Prefer required env for the live call so missing model still surfaces clearly.
  const model = getRequiredEnv("QWEN_OCR_MODEL");
  const endpoint = { baseURL: config.baseURL, model };
  try {
    const client = getClient(endpoint.baseURL);
    const base64 = imageBytes.toString("base64");
    const response = await client.chat.completions.create({
      max_tokens: 4096,
      messages: [
        {
          content: [
            { image_url: { url: `data:${mediaType};base64,${base64}` }, type: "image_url" },
            { text: OCR_PROMPT, type: "text" },
          ],
          role: "user",
        },
      ],
      model,
      temperature: 0,
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Always emit endpoint identity so production 404s are diagnosable without secret env dumps.
    console.error(OCR_LOG_PREFIX, "model call failed", {
      baseURL: endpoint.baseURL,
      errorMessage: message,
      mediaType,
      model: endpoint.model,
    });
    throw new Error(formatOcrErrorMessage(endpoint, message), { cause: error });
  }
}
