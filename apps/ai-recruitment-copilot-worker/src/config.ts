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
  uploaderEmail: string;
  workspaceSlug: string;
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
  return { uploaderEmail, workspaceSlug };
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
