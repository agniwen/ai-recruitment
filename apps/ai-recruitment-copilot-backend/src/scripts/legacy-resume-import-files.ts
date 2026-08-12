import path from "node:path";

export const LEGACY_RESUME_PREFIXES = [
  "dev/legacy-upload/",
  "dev/legacy-upload2/",
  "dev/legacy-upload3/",
  "dev/legacy-upload4/",
  "dev/legacy-upload5/",
  "dev/legacy-upload6/",
] as const;

const SUPPORTED_EXTENSIONS = new Set([".docx", ".jpeg", ".jpg", ".pdf", ".png", ".ppt", ".pptx"]);

export function isSupportedLegacyResumeKey(key: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.posix.extname(key).toLowerCase());
}

export function legacyResumeFileName(key: string): string {
  try {
    return decodeURIComponent(path.posix.basename(key));
  } catch {
    return path.posix.basename(key);
  }
}
