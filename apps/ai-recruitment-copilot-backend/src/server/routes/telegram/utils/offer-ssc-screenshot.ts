import { MAX_TELEGRAM_SCREENSHOT_BYTES } from "./offer-ssc-state";
import type { TelegramScreenshotReference } from "./offer-ssc-state";

function readTelegramFilePath(metadata: unknown): string {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("ok" in metadata) ||
    metadata.ok !== true ||
    !("result" in metadata)
  ) {
    throw new Error("invalid file metadata");
  }
  const file = metadata.result;
  if (
    !file ||
    typeof file !== "object" ||
    !("file_path" in file) ||
    typeof file.file_path !== "string" ||
    !/^[a-zA-Z0-9_./-]+$/u.test(file.file_path) ||
    file.file_path.split("/").includes("..")
  ) {
    throw new Error("invalid file path");
  }
  if (
    "file_size" in file &&
    typeof file.file_size === "number" &&
    file.file_size > MAX_TELEGRAM_SCREENSHOT_BYTES
  ) {
    throw new Error("image too large");
  }
  return file.file_path;
}

async function readScreenshotBytes(
  download: Response,
  controller: AbortController,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!download.ok || !download.body) {
    throw new Error("download failed");
  }
  if (Number(download.headers.get("content-length")) > MAX_TELEGRAM_SCREENSHOT_BYTES) {
    throw new Error("image too large");
  }
  const reader = download.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_TELEGRAM_SCREENSHOT_BYTES) {
        controller.abort();
        throw new Error("image too large");
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // An aborted response may already have closed or errored the stream.
    }
    reader.releaseLock();
  }
  if (size === 0) {
    throw new Error("empty image");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadTelegramOfferScreenshot(
  reference: TelegramScreenshotReference,
): Promise<File> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("Telegram screenshot download unavailable");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      body: JSON.stringify({ file_id: reference.fileId }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("download failed");
    }
    const filePath = readTelegramFilePath(await response.json());
    const download = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
      signal: controller.signal,
    });
    const bytes = await readScreenshotBytes(download, controller);
    return new File([bytes], reference.filename, { type: reference.mediaType });
  } catch {
    // Fetch errors can contain the URL, whose path includes the bot token.
    throw new Error("审批截图下载失败或超过 10 MB，请重新上传后重试。");
  } finally {
    clearTimeout(timeout);
  }
}
