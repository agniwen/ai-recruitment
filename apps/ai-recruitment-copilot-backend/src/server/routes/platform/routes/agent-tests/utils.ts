import { generateText } from "ai";
import type {
  PlatformAgentTestResult,
  PlatformAgentTestsOverview,
  PlatformAgentTestTarget,
  PlatformAgentTestTargetId,
} from "@arc/shared/platform-agent-tests";
import {
  getQwenOcrApiKey,
  qwenVlOcr,
} from "@arc/ai-recruitment-copilot-backend/lib/server/qwen-ocr";
import {
  redactApiUrl,
  redactUrlsInText,
  sanitizeApiUrl,
  sanitizeModelId,
} from "@arc/ai-recruitment-copilot-backend/lib/server/sanitize-api-url";
import { createAlibabaProvider } from "@arc/ai-recruitment-copilot-backend/server/agents/provider";

const PROBE_TIMEOUT_MS = 30_000;
const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAXwAAAA3CAAAAAAqZK4NAAAAz0lEQVR42u3aSw7DIAwFQO5/6XadVLTGsUOkztvyiZmVgxgv2ZaBAD58gQ9f4MMX+PClD38cMx04jUanzOvI7Vz4ycDOUZLAWvjw4cOH/7/401MnR5cQkjt/X1tTQXTF+jz48OHDhw8fPnz48OHDh9+In/yR34qfvF4IVLB06QEfPnz48OGXdjs1HUZ1t9NXQWPPBB8+fPjw4f843JO6nctlwIcPHz58+E/Fnx59w4u1PrbLL+Xgw4cPHz78D3y5O/Dhwxf48AU+fIEPXwrzBqSopfpgG/D4AAAAAElFTkSuQmCC";

function safeEndpoint(value: string | undefined | null): string | null {
  const endpoint = redactApiUrl(value);
  if (!endpoint) {
    return null;
  }
  return endpoint === "(invalid URL)" ? "地址格式无效" : endpoint;
}

function getAlibabaTarget(): PlatformAgentTestTarget {
  const endpoint = safeEndpoint(process.env.ALIBABA_BASE_URL);
  const model = sanitizeModelId(process.env.ALIBABA_MODEL) || null;
  const baseUrlConfigured = Boolean(sanitizeApiUrl(process.env.ALIBABA_BASE_URL));
  const credentialConfigured = Boolean(process.env.ALIBABA_API_KEY?.trim());
  const modelConfigured = Boolean(model);
  return {
    baseUrlConfigured,
    credentialConfigured,
    endpoint,
    envName: "ALIBABA_BASE_URL",
    id: "alibaba",
    model,
    modelConfigured,
    ready: baseUrlConfigured && credentialConfigured && modelConfigured,
    title: "Alibaba 文本模型",
  };
}

function getQwenOcrTarget(): PlatformAgentTestTarget {
  const baseUrlConfigured = Boolean(sanitizeApiUrl(process.env.QWEN_OCR_BASE_URL));
  const credentialConfigured = Boolean(getQwenOcrApiKey());
  const model = sanitizeModelId(process.env.QWEN_OCR_MODEL) || null;
  const modelConfigured = Boolean(model);
  return {
    baseUrlConfigured,
    credentialConfigured,
    endpoint: safeEndpoint(process.env.QWEN_OCR_BASE_URL),
    envName: "QWEN_OCR_BASE_URL",
    id: "qwen_ocr",
    model,
    modelConfigured,
    ready: baseUrlConfigured && credentialConfigured && modelConfigured,
    title: "Qwen OCR",
  };
}

export function getAgentTestsOverview(): PlatformAgentTestsOverview {
  return { targets: [getAlibabaTarget(), getQwenOcrTarget()] };
}

function redactError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.ALIBABA_API_KEY, process.env.QWEN_OCR_API_KEY]) {
    if (secret?.trim()) {
      message = message.replaceAll(secret, "[REDACTED]");
    }
  }
  return redactUrlsInText(message).slice(0, 500);
}

async function runProbe(
  id: PlatformAgentTestTargetId,
  target: PlatformAgentTestTarget,
  probe: () => Promise<string>,
): Promise<PlatformAgentTestResult> {
  const startedAt = performance.now();
  try {
    const response = await probe();
    if (!response.trim()) {
      throw new Error("模型请求成功，但返回内容为空。");
    }
    return {
      endpoint: target.endpoint,
      error: null,
      id,
      latencyMs: Math.round(performance.now() - startedAt),
      model: target.model,
      responsePreview: response.trim().slice(0, 300),
      status: "passed",
      testedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      endpoint: target.endpoint,
      error: redactError(error),
      id,
      latencyMs: Math.round(performance.now() - startedAt),
      model: target.model,
      responsePreview: null,
      status: "failed",
      testedAt: new Date().toISOString(),
    };
  }
}

export function testAlibabaAgent(): Promise<PlatformAgentTestResult> {
  const target = getAlibabaTarget();
  return runProbe("alibaba", target, async () => {
    if (!target.ready || !target.model) {
      throw new Error("ALIBABA_BASE_URL、ALIBABA_API_KEY 或 ALIBABA_MODEL 未配置完整。");
    }
    const provider = createAlibabaProvider();
    const result = await generateText({
      abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      maxOutputTokens: 16,
      model: provider(target.model),
      prompt: "这是连通性测试。请只回复：OK",
      temperature: 0,
    });
    return result.text;
  });
}

export function testQwenOcrAgent(): Promise<PlatformAgentTestResult> {
  const target = getQwenOcrTarget();
  return runProbe("qwen_ocr", target, async () => {
    if (!target.ready) {
      throw new Error(
        "QWEN_OCR_BASE_URL、QWEN_OCR_MODEL 及 QWEN_OCR_API_KEY/ALIBABA_API_KEY 未配置完整。",
      );
    }
    const response = await qwenVlOcr(Buffer.from(TEST_IMAGE_BASE64, "base64"), "image/png", {
      maxOutputTokens: 64,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (
      !response
        .replaceAll(/[^a-z]/giu, "")
        .toUpperCase()
        .includes("ARCOCRTEST")
    ) {
      throw new Error("OCR 请求成功，但未识别出测试图片中的 ARC OCR TEST。");
    }
    return response;
  });
}
