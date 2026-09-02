export type PlatformAgentTestTargetId = "alibaba" | "qwen_ocr";

export interface PlatformAgentTestTarget {
  baseUrlConfigured: boolean;
  credentialConfigured: boolean;
  endpoint: string | null;
  envName: "ALIBABA_BASE_URL" | "QWEN_OCR_BASE_URL";
  id: PlatformAgentTestTargetId;
  model: string | null;
  modelConfigured: boolean;
  ready: boolean;
  title: string;
}

export interface PlatformAgentTestsOverview {
  targets: PlatformAgentTestTarget[];
}

export interface PlatformAgentTestResult {
  endpoint: string | null;
  error: string | null;
  id: PlatformAgentTestTargetId;
  latencyMs: number;
  model: string | null;
  responsePreview: string | null;
  status: "failed" | "passed";
  testedAt: string;
}
