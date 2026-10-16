import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  copyFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "apps/ai-recruitment-copilot/package.json"));
const { parse } = require("dotenv");
const paths = {
  agent: "apps/livekit-agent/.env",
  web: "apps/ai-recruitment-copilot/.env",
  worker: "apps/ai-recruitment-copilot-worker/.env",
};
const read = (path) => parse(readFileSync(resolve(root, path)));
const original = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, read(path)]),
);
const privateDir = resolve(root, ".devtools/dev-prod");
const settingsPath = resolve(root, ".env.dev-prod.local");
const saved = existsSync(settingsPath) ? read(settingsPath) : {};
const db = new URL(original.web.DATABASE_URL);
if (
  !["127.0.0.1", "localhost"].includes(db.hostname) ||
  db.port !== "54324" ||
  db.pathname !== "/ai_recruitment"
) {
  throw new Error(
    "Expected the existing local ai_recruitment database on port 54324; no files changed.",
  );
}
// Avoid a higher-priority override silently keeping an app connected elsewhere.
for (const path of Object.values(paths)) {
  if (existsSync(resolve(root, `${path}.local`))) {
    throw new Error(`Review ${path}.local before configuring; no files changed.`);
  }
}
const hostIp =
  process.env.DEV_PROD_HOST_IP ||
  networkInterfaces().en0?.find((address) => address.family === "IPv4" && !address.internal)
    ?.address;
if (!hostIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostIp)) {
  throw new Error("Set DEV_PROD_HOST_IP to this computer's reachable LAN IPv4 address.");
}
const secret = () => randomBytes(32).toString("hex");
const settings = {
  DEV_PROD_HOST_IP: hostIp,
  LOCAL_CALLBACK_SECRET: saved.LOCAL_CALLBACK_SECRET || secret(),
  LOCAL_LIVEKIT_KEY: saved.LOCAL_LIVEKIT_KEY || "arc-local",
  LOCAL_LIVEKIT_SECRET: saved.LOCAL_LIVEKIT_SECRET || secret(),
  LOCAL_MINIO_PASSWORD: saved.LOCAL_MINIO_PASSWORD || secret(),
  LOCAL_MINIO_USER: saved.LOCAL_MINIO_USER || "arc-local",
  LOCAL_POSTGRES_PASSWORD: decodeURIComponent(db.password),
  LOCAL_POSTGRES_USER: decodeURIComponent(db.username),
};
function privateWrite(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}
const envText = (values) =>
  `${Object.entries(values)
    .map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`)
    .join("\n")}\n`;
mkdirSync(privateDir, { mode: 0o700, recursive: true });
const backupDir = resolve(privateDir, "backups", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(backupDir, { mode: 0o700, recursive: true });
for (const [name, path] of Object.entries(paths)) {
  const target = resolve(backupDir, `${name}.env`);
  copyFileSync(resolve(root, path), target);
  chmodSync(target, 0o600);
}
privateWrite(settingsPath, envText(settings));
const common = {
  AGENT_CALLBACK_SECRET: settings.LOCAL_CALLBACK_SECRET,
  AGENT_NAME: "arc-local",
  CALLBACK_BASE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: original.web.DATABASE_URL,
  ENABLE_LEGACY_PARSE: "false",
  HUMAN_INTERVIEW_MEDIA_ENABLED: "true",
  HUMAN_INTERVIEW_REMINDERS_ENABLED: "false",
  INTERVIEW_MEDIA_LOCAL_DIR: "",
  INTERVIEW_SELF_HOSTED: "1",
  LIVEKIT_API_KEY: settings.LOCAL_LIVEKIT_KEY,
  LIVEKIT_API_SECRET: settings.LOCAL_LIVEKIT_SECRET,
  LIVEKIT_PROMETHEUS_URL: "",
  LIVEKIT_URL: "ws://127.0.0.1:17890",
  MAIL_INGEST_ENABLED: "false",
  NEXT_PUBLIC_AGENT_NAME: "arc-local",
  QDRANT_API_KEY: "",
  QDRANT_URL: "http://127.0.0.1:16333",
  RECORDING_R2_ACCESS_KEY_ID: settings.LOCAL_MINIO_USER,
  RECORDING_R2_BUCKET_NAME: "ai-recruitment-recordings",
  RECORDING_R2_ENDPOINT: "http://127.0.0.1:19100",
  RECORDING_R2_FORCE_PATH_STYLE: "true",
  RECORDING_R2_KEY_PREFIX: "recordings",
  RECORDING_R2_REGION: "us-east-1",
  RECORDING_R2_SECRET_ACCESS_KEY: settings.LOCAL_MINIO_PASSWORD,
  REDIS_URL: "redis://127.0.0.1:16379/0",
  RESUME_PARSE_QUEUE_PREFIX: "arc:ai-recruitment:dev-prod",
  S3_ACCESS_KEY_ID: settings.LOCAL_MINIO_USER,
  S3_BUCKET_NAME: "ai-recruitment-resumes",
  S3_ENDPOINT: "http://127.0.0.1:19100",
  S3_FORCE_PATH_STYLE: "true",
  S3_KEY_PREFIX: "uploads",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: settings.LOCAL_MINIO_PASSWORD,
};
function updateEnv(path, values) {
  let contents = readFileSync(resolve(root, path), "utf-8");
  for (const [key, value] of Object.entries(values)) {
    const line = envText({ [key]: value }).trimEnd();
    const pattern = new RegExp(`^(?:export\\s+)?${key}=.*$`, "gm");
    contents = pattern.test(contents)
      ? contents.replace(pattern, () => line)
      : `${contents.trimEnd()}\n${line}\n`;
  }
  privateWrite(resolve(root, path), contents);
}
for (const [name, path] of Object.entries(paths)) {
  updateEnv(path, {
    ...common,
    ...(name === "agent"
      ? {
          // This endpoint is sent to Egress, which uploads from inside Docker.
          RECORDING_R2_ENDPOINT: "http://minio:9000",
        }
      : {
          BETTER_AUTH_URL: "http://localhost:3000",
          INTERVIEW_ENTRY_CREDENTIAL_ORIGIN: "http://localhost:3000",
          NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
          NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000",
        }),
  });
}
privateWrite(
  resolve(privateDir, "livekit.yaml"),
  JSON.stringify(
    {
      bind_addresses: ["0.0.0.0"],
      keys: { [settings.LOCAL_LIVEKIT_KEY]: settings.LOCAL_LIVEKIT_SECRET },
      logging: { json: true, level: "info" },
      port: 7880,
      redis: { address: "redis:6379", db: 2 },
      rtc: { node_ip: hostIp, tcp_port: 17_891, udp_port: 17_892, use_external_ip: false },
      webhook: {
        api_key: settings.LOCAL_LIVEKIT_KEY,
        urls: ["http://host.docker.internal:3000/api/livekit/webhook"],
      },
    },
    null,
    2,
  ),
);
// Egress runs as a non-root user; the mount directory remains private on the host.
privateWrite(
  resolve(privateDir, "egress.yaml"),
  JSON.stringify(
    {
      api_key: settings.LOCAL_LIVEKIT_KEY,
      api_secret: settings.LOCAL_LIVEKIT_SECRET,
      health_port: 9090,
      insecure: true,
      logging: { json: true, level: "info" },
      redis: { address: "redis:6379", db: 2 },
      ws_url: "ws://livekit:7880",
    },
    null,
    2,
  ),
);
chmodSync(resolve(privateDir, "egress.yaml"), 0o644);
console.log(`Local configuration written; original .env files backed up to ${backupDir}`);
console.log(
  `RTC address: ${hostIp}; model/provider settings preserved. Restart native apps after starting dependencies.`,
);
