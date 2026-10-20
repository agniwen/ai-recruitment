import { readFileSync } from "node:fs";

export function readTestSource(file: string | URL, encoding: BufferEncoding = "utf-8"): string {
  return readFileSync(file, encoding).replaceAll("\r\n", "\n");
}
