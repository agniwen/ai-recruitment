import path from "node:path";
import { config as loadEnvFile } from "dotenv";

const backendRoot = path.resolve(import.meta.dirname, "../..");
const webAppRoot = path.resolve(backendRoot, "../ai-recruitment-copilot");

/**
 * Load env for standalone backend / scripts.
 * Prefer the web app env (`apps/ai-recruitment-copilot`) because that is where
 * shared secrets live in this monorepo; backend-local files can still fill gaps.
 *
 * Precedence (first wins per key, dotenv default):
 * web .env.local → web .env → backend .env.local → backend .env
 */
export function loadStandaloneEnv() {
  for (const envPath of [
    path.join(webAppRoot, ".env.local"),
    path.join(webAppRoot, ".env"),
    path.join(backendRoot, ".env.local"),
    path.join(backendRoot, ".env"),
  ]) {
    loadEnvFile({ path: envPath, quiet: true });
  }
}
