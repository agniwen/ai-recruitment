export interface WorkerServerConfig {
  hostname: string;
  port: number;
}

export function isLegacyParseEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ENABLE_LEGACY_PARSE?.trim().toLowerCase() === "true";
}

export interface LegacyParseConfig {
  queueHighWatermark: number;
  queueLowWatermark: number;
  uploaderEmail: string;
  workspaceSlug: string;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveLegacyParseConfig(
  env: Record<string, string | undefined> = process.env,
): LegacyParseConfig | null {
  if (!isLegacyParseEnabled(env)) {
    return null;
  }
  const workspaceSlug = env.LEGACY_PARSE_WORKSPACE_SLUG?.trim();
  const uploaderEmail = env.LEGACY_PARSE_UPLOADER_EMAIL?.trim();
  if (!workspaceSlug) {
    throw new Error("ENABLE_LEGACY_PARSE=true 时必须配置 LEGACY_PARSE_WORKSPACE_SLUG。");
  }
  if (!uploaderEmail) {
    throw new Error("ENABLE_LEGACY_PARSE=true 时必须配置 LEGACY_PARSE_UPLOADER_EMAIL。");
  }
  const queueHighWatermark = parsePositiveInteger(env.LEGACY_PARSE_QUEUE_HIGH_WATERMARK, 500);
  const queueLowWatermark = parsePositiveInteger(env.LEGACY_PARSE_QUEUE_LOW_WATERMARK, 200);
  if (queueLowWatermark >= queueHighWatermark) {
    throw new Error("LEGACY_PARSE_QUEUE_LOW_WATERMARK 必须小于 HIGH_WATERMARK。");
  }
  return { queueHighWatermark, queueLowWatermark, uploaderEmail, workspaceSlug };
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWorkerServerConfig(): WorkerServerConfig {
  return {
    hostname: process.env.WORKER_HOST || "0.0.0.0",
    port: parsePort(process.env.WORKER_PORT, 8790),
  };
}
