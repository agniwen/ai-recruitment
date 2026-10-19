import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dirname, "..");
const web = "apps/ai-recruitment-copilot/.env";
const worker = "apps/ai-recruitment-copilot-worker/.env";
const agent = "apps/livekit-agent/.env";
const settings = ".env.dev-prod.local";
const compose = ["compose", "--env-file", settings, "-f", "dev-prod.yaml"];
const dataKeys = [
  "BETTER_AUTH_SECRET",
  "MAIL_INGEST_SECRET_KEY",
  "ADMIN_MFA_KEY",
  "IP_ENCRYPTION_CONTEXT",
  "IP_ENCRYPTION_KEY_ID",
  "IP_ENCRYPTION_PUBLIC_KEY",
  "IP_ENCRYPTION_PRIVATE_KEY",
  "IP_LOOKUP_KEY",
];
const providerKeys = new Set([
  "ALIBABA_API_KEY",
  "ALIBABA_BASE_URL",
  "ALIBABA_MODEL",
  "ALIBABA_FAST_MODEL",
  "ALIBABA_STRUCTURED_MODEL",
  "ALIBABA_VISION_MODEL",
  "QWEN_OCR_API_KEY",
  "QWEN_OCR_BASE_URL",
  "QWEN_OCR_MODEL",
  "RESUME_PARSE_PROVIDER",
  "RESUME_EMBEDDING_API_KEY",
  "RESUME_EMBEDDING_BASE_URL",
  "RESUME_EMBEDDING_MODEL",
  "RESUME_EMBEDDING_DIMENSIONS",
  "RESUME_EMBEDDING_VERSION",
  "RESUME_RERANK_API_KEY",
  "RESUME_RERANK_URL",
  "RESUME_RERANK_MODEL",
  "AI_GATEWAY_API_KEY",
  "INTERVIEW_EVALUATION_MODEL",
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_LLM_MODEL",
  "ELEVEN_API_KEY",
  "ELEVENLABS_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_TTS_BASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_APP_ID2",
  "FEISHU_APP_SECRET2",
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error?.code === "ENOENT") {
    throw new Error(`缺少 ${command}，请先执行 bash scripts/bootstrap-local.sh。`);
  }
  if (result.error || result.status !== 0) {
    throw new Error(`${command} 执行失败（${result.status ?? result.error.code}）。`);
  }
  return result.stdout?.toString().trim();
}
const capture = (command, args) => run(command, args, { stdio: ["ignore", "pipe", "inherit"] });
const readEnv = (path) => parseEnv(readFileSync(resolve(root, path), "utf-8"));
const secret = () => randomBytes(32).toString("hex");

export function envText(values) {
  return `${Object.entries(values)
    .map(([key, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /['\r\n]/.test(value)) {
        throw new Error(`不支持的环境变量格式：${key}`);
      }
      return `${key}='${value}'`;
    })
    .join("\n")}\n`;
}

function privateWrite(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function assertLocalDatabase(env, local) {
  const db = new URL(env.DATABASE_URL);
  if (db.protocol !== "postgresql:" && db.protocol !== "postgres:") {
    throw new Error("只支持 PostgreSQL。");
  }
  if (
    !["localhost", "127.0.0.1"].includes(db.hostname) ||
    db.port !== "54324" ||
    db.pathname !== "/ai_recruitment" ||
    db.search ||
    db.hash ||
    decodeURIComponent(db.username) !== local.LOCAL_POSTGRES_USER ||
    decodeURIComponent(db.password) !== local.LOCAL_POSTGRES_PASSWORD
  ) {
    throw new Error("只允许 .env.dev-prod.local 对应的本地 54324/ai_recruitment 数据库。");
  }
}

function checkLocal() {
  const env = readEnv(web);
  assertLocalDatabase(env, readEnv(settings));
  for (const key of ["DATABASE_URL", ...dataKeys]) {
    if (process.env[key] && process.env[key] !== env[key]) {
      throw new Error(`当前终端的 ${key} 会覆盖应用配置，请先移除该覆盖。`);
    }
  }
  for (const path of [web, worker, agent]) {
    if (existsSync(resolve(root, `${path}.local`))) {
      throw new Error(`请先处理高优先级配置 ${path}.local。`);
    }
  }
  return env;
}

function postgres(args, options) {
  return run("docker", [...compose, "exec", "-T", "postgres", "sh", "-ec", args], options);
}
const sql = (query) =>
  postgres('exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At', {
    input: query,
    stdio: ["pipe", "pipe", "inherit"],
  });
const tableCountSql =
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';";

function digest(path) {
  // The dump is compressed; avoid holding the entire database in memory.
  return capture(process.execPath, [
    "--input-type=module",
    "-e",
    "import{createReadStream}from'node:fs';import{createHash}from'node:crypto';const h=createHash('sha256');for await(const c of createReadStream(process.argv[1]))h.update(c);console.log(h.digest('hex'));",
    path,
  ]);
}

export function readBundle(directory) {
  const path = resolve(directory);
  const manifest = JSON.parse(readFileSync(resolve(path, "manifest.json"), "utf-8"));
  if (manifest.version !== 1 || manifest.database !== "ai_recruitment") {
    throw new Error("不支持的数据包格式。");
  }
  for (const file of ["database.dump", "data-keys.env"]) {
    if (!manifest.sha256?.[file] || digest(resolve(path, file)) !== manifest.sha256[file]) {
      throw new Error(`数据包校验失败：${file}`);
    }
  }
  const keys = parseEnv(readFileSync(resolve(path, "data-keys.env"), "utf-8"));
  if (Object.keys(keys).some((key) => !dataKeys.includes(key)) || !keys.BETTER_AUTH_SECRET) {
    throw new Error("数据密钥文件包含不支持的字段或缺少认证密钥。");
  }
  return { keys, manifest, path };
}

function exportDatabase() {
  const env = checkLocal();
  // ZIP deliveries have no Git metadata; database export still works there.
  const hasGit = existsSync(resolve(root, ".git"));
  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" });
  const gitStatus = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" });
  const directory = resolve(
    root,
    ".devtools/handoff",
    new Date().toISOString().replaceAll(":", "-"),
  );
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const dump = resolve(directory, "database.dump");
  const fd = openSync(dump, "wx", 0o600);
  try {
    postgres(
      'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges',
      { stdio: ["ignore", fd, "inherit"] },
    );
  } finally {
    closeSync(fd);
  }
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("缺少 BETTER_AUTH_SECRET，数据包未完成。");
  }
  const keys = Object.fromEntries(dataKeys.filter((key) => env[key]).map((key) => [key, env[key]]));
  privateWrite(resolve(directory, "data-keys.env"), envText(keys));
  const manifest = {
    createdAt: new Date().toISOString(),
    database: "ai_recruitment",
    dirtyWorktree: hasGit && gitStatus.status === 0 ? Boolean(gitStatus.stdout.trim()) : null,
    excludes: ["MinIO 文件", "Qdrant 索引", "Redis 队列", "模型 API Key", "OAuth 应用凭据"],
    gitHead: hasGit && gitHead.status === 0 ? gitHead.stdout.trim() : null,
    postgresVersion: sql("SHOW server_version;"),
    sha256: Object.fromEntries(
      ["database.dump", "data-keys.env"].map((file) => [file, digest(resolve(directory, file))]),
    ),
    version: 1,
  };
  privateWrite(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`数据库交接包：${directory}\n包含账号、业务数据及解密密钥，请通过私密渠道交给同事。`);
}

function importDatabase(directory) {
  if (!directory) {
    throw new Error("用法：node scripts/local-dev.mjs import <数据包目录>");
  }
  checkLocal();
  const bundle = readBundle(directory);
  if (sql(tableCountSql) !== "0") {
    throw new Error("目标数据库已有表或序列，拒绝覆盖。请使用新电脑的空数据库。不会自动清库。");
  }
  const updatedEnvs = [web, worker].map((path) => [
    path,
    envText({ ...readEnv(path), ...bundle.keys }),
  ]);
  // Validate the archive before starting the single-transaction restore.
  const fd = openSync(resolve(bundle.path, "database.dump"), "r");
  try {
    postgres("exec pg_restore --list", { stdio: [fd, "ignore", "inherit"] });
  } finally {
    closeSync(fd);
  }
  const restoreFd = openSync(resolve(bundle.path, "database.dump"), "r");
  try {
    postgres(
      'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error --single-transaction',
      { stdio: [restoreFd, "inherit", "inherit"] },
    );
  } finally {
    closeSync(restoreFd);
  }
  const backupDir = resolve(
    root,
    ".devtools/handoff/import-backups",
    new Date().toISOString().replaceAll(":", "-"),
  );
  mkdirSync(backupDir, { mode: 0o700, recursive: true });
  for (const [path, contents] of updatedEnvs) {
    privateWrite(
      resolve(backupDir, path === web ? "web.env" : "worker.env"),
      readFileSync(resolve(root, path)),
    );
    privateWrite(resolve(root, path), contents);
  }
  console.log(`已导入 ${bundle.manifest.createdAt} 的数据库快照和对应解密密钥。请重启应用。`);
}

function detectHostIp() {
  return (
    process.env.DEV_PROD_HOST_IP ||
    Object.values(networkInterfaces())
      .flat()
      .find(
        (address) =>
          address?.family === "IPv4" &&
          !address.internal &&
          !address.address.startsWith("169.254."),
      )?.address
  );
}

function setup(directory) {
  if (Number(process.versions.node.split(".")[0]) < 24) {
    throw new Error("请安装 Node.js 24 LTS。");
  }
  const bundle = directory ? readBundle(directory) : undefined;
  const hostIp = detectHostIp();
  if (!hostIp) {
    throw new Error("请设置 DEV_PROD_HOST_IP 为本机可访问的局域网 IPv4。");
  }
  for (const path of [web, worker, agent, settings]) {
    if (existsSync(resolve(root, path)) || existsSync(resolve(root, `${path}.local`))) {
      throw new Error(
        `已有 ${path} 或其 .local 文件；setup 只用于新电脑，拒绝覆盖。日常启动使用 up。`,
      );
    }
  }
  for (const key of ["DATABASE_URL", ...dataKeys]) {
    if (process.env[key]) {
      throw new Error(`请先移除当前终端的 ${key} 覆盖。`);
    }
  }
  run("pnpm", ["--version"]);
  run("uv", ["--version"]);
  run("make", ["--version"]);
  run("docker", ["info"], { stdio: "ignore" });
  run("docker", ["compose", "version"]);
  const existingVolume = spawnSync(
    "docker",
    ["volume", "inspect", "ai-recruitment-local-db_data"],
    { stdio: "ignore" },
  );
  if (existingVolume.status === 0) {
    throw new Error("发现已有 PostgreSQL 数据卷，拒绝接管。setup 只用于全新本地环境。");
  }
  const providerPath = resolve(root, ".env.local-providers");
  const providers = existsSync(providerPath) ? readEnv(providerPath) : {};
  for (const key of Object.keys(providers)) {
    if (!providerKeys.has(key)) {
      throw new Error(`.env.local-providers 不允许覆盖 ${key}。`);
    }
  }
  run("pnpm", ["install", "--frozen-lockfile"]);
  run("uv", ["sync", "--frozen", "--python", "3.12"], { cwd: resolve(root, "apps/livekit-agent") });
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const keys = {
    ADMIN_MFA_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_SECRET: secret(),
    IP_ENCRYPTION_CONTEXT: "arc-local",
    IP_ENCRYPTION_KEY_ID: "local-v1",
    IP_ENCRYPTION_PRIVATE_KEY: Buffer.from(pair.privateKey).toString("base64"),
    IP_ENCRYPTION_PUBLIC_KEY: Buffer.from(pair.publicKey).toString("base64"),
    IP_LOOKUP_KEY: randomBytes(32).toString("base64"),
    MAIL_INGEST_SECRET_KEY: secret(),
    ...bundle?.keys,
  };
  const defaults = {
    ...keys,
    DATABASE_URL: `postgresql://arc_local:${secret()}@127.0.0.1:54324/ai_recruitment`,
    FEISHU_APP_ID: "local-disabled",
    FEISHU_APP_ID2: "local-disabled",
    FEISHU_APP_SECRET: "local-disabled",
    FEISHU_APP_SECRET2: "local-disabled",
    GOOGLE_CLIENT_ID: "local-disabled",
    GOOGLE_CLIENT_SECRET: "local-disabled",
    ...providers,
  };
  for (const path of [web, worker, agent]) {
    privateWrite(
      resolve(root, path),
      envText({
        ...readEnv(`${path}.example`),
        ...defaults,
        DASHSCOPE_API_KEY: providers.DASHSCOPE_API_KEY || providers.ALIBABA_API_KEY || "",
        ELEVEN_API_KEY: providers.ELEVEN_API_KEY || providers.ELEVENLABS_API_KEY || "",
      }),
    );
  }
  run(process.execPath, ["scripts/configure-dev-prod.mjs"], {
    env: { ...process.env, DEV_PROD_HOST_IP: hostIp },
  });
  run("docker", ["volume", "create", "ai-recruitment-local-db_data"]);
  run("docker", [...compose, "up", "-d", "--wait", "--wait-timeout", "180", "postgres"]);
  if (bundle) {
    importDatabase(bundle.path);
  }
  run("pnpm", ["db:migrate"]);
  run("uv", ["run", "src/agent.py", "download-files"], {
    cwd: resolve(root, "apps/livekit-agent"),
  });
  run("docker", [...compose, "up", "-d"]);
  console.log("初始化完成。执行 node scripts/local-dev.mjs up 启动 Web、worker 和语音 agent。");
  console.log(
    "模型 Key 请在初始化前写入 .env.local-providers；未配置时业务页面可启动，但 AI 调用不可用。",
  );
}

export function main([command, directory] = process.argv.slice(2)) {
  process.chdir(root);
  switch (command) {
    case "setup": {
      return setup(directory);
    }
    case "export": {
      return exportDatabase();
    }
    case "import": {
      return importDatabase(directory);
    }
    case "up": {
      checkLocal();
      return run("make", ["dev-prod"]);
    }
    case "status": {
      checkLocal();
      return run("docker", [...compose, "ps"]);
    }
    case "migrate": {
      checkLocal();
      return run("pnpm", ["db:migrate"]);
    }
    default: {
      if (command && !["help", "--help"].includes(command)) {
        throw new Error(`未知命令：${command}`);
      }
      console.log(
        "工具安装：bash scripts/bootstrap-local.sh\n新电脑：bash scripts/local.sh setup [数据包目录]\n日常启动：bash scripts/local.sh up\n查看状态：bash scripts/local.sh status\n导出数据：bash scripts/local.sh export\n空库导入：bash scripts/local.sh import <数据包目录>\n数据库迁移：bash scripts/local.sh migrate\n完整说明：docs/local-handoff.md",
      );
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
