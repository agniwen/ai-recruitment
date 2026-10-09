import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  deleteRecordingSample,
  getRecordingSample,
  isRecordingStorageConfigured,
  putRecordingSample,
} from "@arc/ai-recruitment-copilot-backend/lib/server/s3";

function localDirectory() {
  const directory = process.env.INTERVIEW_MEDIA_LOCAL_DIR;
  if (process.env.NODE_ENV === "production" || !directory || !isAbsolute(directory)) {
    throw new Error(
      "Local interview media storage is only allowed with an absolute development directory",
    );
  }
  return directory;
}
export function mediaStorageBackend(): "local" | "r2" {
  if (process.env.INTERVIEW_MEDIA_LOCAL_DIR) {
    localDirectory();
    return "local";
  }
  if (!isRecordingStorageConfigured()) {
    throw new Error("Interview media recording storage is not configured");
  }
  return "r2";
}
function validateKey(key: string) {
  if (!/^human-interview-samples\/[a-f0-9-]+\.(jpg|wav)$/.test(key)) {
    throw new Error("Invalid media key");
  }
  return key;
}
export async function writeMedia(
  backend: "local" | "r2",
  key: string,
  bytes: Uint8Array,
  contentType: string,
) {
  validateKey(key);
  if (backend === "r2") {
    return putRecordingSample(key, bytes, contentType);
  }
  const root = localDirectory();
  await mkdir(join(root, "human-interview-samples"), { mode: 0o700, recursive: true });
  await writeFile(join(root, key), bytes, { mode: 0o600 });
}
export function readMedia(backend: "local" | "r2", key: string) {
  validateKey(key);
  return backend === "r2" ? getRecordingSample(key) : readFile(join(localDirectory(), key));
}
export async function removeMedia(backend: "local" | "r2", key: string) {
  validateKey(key);
  if (backend === "r2") {
    return deleteRecordingSample(key);
  }
  try {
    await unlink(join(localDirectory(), key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
