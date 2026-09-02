// Qwen-VL OCR via DashScope (OpenAI-compatible mode).
// Used as visual fallback for image-based PDF resumes.

import OpenAI from "openai";
import { getRequiredEnv } from "./env";
import {
  redactApiUrl,
  redactUrlsInText,
  sanitizeApiUrl,
  sanitizeModelId,
} from "./sanitize-api-url";

const OCR_PROMPT =
  "请完整提取这张简历图片中的所有文字，包括所有图片、图表、表格中的文字。保持原始排版顺序，表格用文字形式还原。只输出提取的文字，不要解释。";
const DEFAULT_QWEN_OCR_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const OCR_LOG_PREFIX = "[resume-ocr]";

let cachedClient: OpenAI | null = null;
let cachedClientKey: string | null = null;

export interface QwenOcrEndpointConfig {
  apiKeySource: "QWEN_OCR_API_KEY" | "ALIBABA_API_KEY" | "unset";
  baseURL: string;
  model: string;
}

export interface QwenOcrCallOptions {
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/** Prefer dedicated OCR key so Token Plan keys can stay on ALIBABA_API_KEY. */
export function getQwenOcrApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.QWEN_OCR_API_KEY?.trim() || env.ALIBABA_API_KEY?.trim() || undefined;
}

export function getQwenOcrEndpointConfig(
  env: NodeJS.ProcessEnv = process.env,
): QwenOcrEndpointConfig {
  const hasDedicatedKey = Boolean(env.QWEN_OCR_API_KEY?.trim());
  const hasFallbackKey = Boolean(env.ALIBABA_API_KEY?.trim());
  let apiKeySource: QwenOcrEndpointConfig["apiKeySource"] = "unset";
  if (hasDedicatedKey) {
    apiKeySource = "QWEN_OCR_API_KEY";
  } else if (hasFallbackKey) {
    apiKeySource = "ALIBABA_API_KEY";
  }
  return {
    apiKeySource,
    baseURL: sanitizeApiUrl(env.QWEN_OCR_BASE_URL, DEFAULT_QWEN_OCR_BASE_URL),
    model: sanitizeModelId(env.QWEN_OCR_MODEL, "(QWEN_OCR_MODEL unset)"),
  };
}

function getClient(baseURL: string, apiKey: string): OpenAI {
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

export function isQwenOcrConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getQwenOcrApiKey(env));
}

function formatOcrErrorMessage(config: QwenOcrEndpointConfig, message: string): string {
  return `Qwen OCR failed (model=${config.model}, baseURL=${redactApiUrl(config.baseURL)}, key=${config.apiKeySource}): ${message}`;
}

function redactOcrErrorDetail(
  config: QwenOcrEndpointConfig,
  apiKey: string,
  message: string,
): string {
  const withoutKey = message.replaceAll(apiKey, "[REDACTED]");
  return redactUrlsInText(withoutKey.replaceAll(config.baseURL, redactApiUrl(config.baseURL)));
}

export async function qwenVlOcr(
  imageBytes: Buffer,
  mediaType = "image/png",
  options: QwenOcrCallOptions = {},
): Promise<string> {
  // Ensure required env is present, then sanitize (strips zero-width paste junk).
  getRequiredEnv("QWEN_OCR_MODEL");
  const config = getQwenOcrEndpointConfig();
  const { model } = config;
  const apiKey = getQwenOcrApiKey();
  if (!apiKey) {
    throw new Error("Qwen OCR is not configured (set QWEN_OCR_API_KEY or ALIBABA_API_KEY).");
  }
  const endpoint = { ...config, model };
  try {
    const client = getClient(endpoint.baseURL, apiKey);
    const base64 = imageBytes.toString("base64");
    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      enable_thinking: false;
    } = {
      enable_thinking: false,
      max_tokens: options.maxOutputTokens ?? 4096,
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
    };
    const response = options.signal
      ? await client.chat.completions.create(request, { signal: options.signal })
      : await client.chat.completions.create(request);
    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = redactOcrErrorDetail(endpoint, apiKey, message);
    // Always emit endpoint identity so production failures are diagnosable (never log the key).
    console.error(OCR_LOG_PREFIX, "model call failed", {
      apiKeySource: endpoint.apiKeySource,
      baseURL: redactApiUrl(endpoint.baseURL),
      errorMessage: safeMessage,
      mediaType,
      model: endpoint.model,
    });
    throw new Error(formatOcrErrorMessage(endpoint, safeMessage), { cause: error });
  }
}
