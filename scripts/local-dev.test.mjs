import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseEnv } from "node:util";
import { assertLocalDatabase, envText, readBundle } from "./local-dev.mjs";

const local = { LOCAL_POSTGRES_PASSWORD: "private-test", LOCAL_POSTGRES_USER: "arc" };
const url = "postgresql://arc:private-test@127.0.0.1:54324/ai_recruitment";
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("工具只检查模式区分 Docker 就绪和不可用，且不会安装软件或打开界面", () => {
  const script = fileURLToPath(new URL("bootstrap-local.sh", import.meta.url));
  for (const dockerStatus of [0, 1]) {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
      git() { :; }; make() { :; }; uv() { :; }; node() { :; }
      pnpm() { printf '11.5.2\\n'; }
      docker() { return ${dockerStatus}; }
      brew() { exit 91; }; npm() { exit 91; }; curl() { exit 91; }
      open() { exit 91; }; sudo() { exit 91; }
      export -f git make uv node pnpm docker brew npm curl open sudo
      bash "$1" --check
    `,
        "--",
        script,
      ],
      { encoding: "utf-8" },
    );
    assert.equal(result.status, dockerStatus, result.stderr);
    assert.match(
      result.stdout,
      dockerStatus === 0 ? /Docker 和 Compose：可用/ : /Docker\/Compose 未安装/,
    );
  }
});

test("只允许已配置的本地数据库，拒绝远程地址、其他库和连接参数重定向", () => {
  assert.doesNotThrow(() => assertLocalDatabase({ DATABASE_URL: url }, local));
  for (const invalid of [
    url.replace("127.0.0.1", "db.example.com"),
    url.replace("54324", "5432"),
    url.replace("ai_recruitment", "other"),
    url.replace("private-test", "wrong"),
    `${url}?host=db.example.com`,
    url.replace("postgresql:", "https:"),
  ]) {
    assert.throws(() => assertLocalDatabase({ DATABASE_URL: invalid }, local));
  }
});

test("环境文件可解析且不会接受换行注入", () => {
  const values = { EMPTY: "", TEST_KEY: "abc$def#ghi=" };
  assert.deepEqual(parseEnv(envText(values)), values);
  assert.throws(() => envText({ TEST_KEY: "x\nDATABASE_URL=remote" }));
  assert.throws(() => envText({ TEST_KEY: "quote'" }));
  assert.throws(() => envText({ "BAD-KEY": "value" }));
});

test("导入前核对快照及密钥校验和，并拒绝额外基础设施配置", () => {
  const directory = mkdtempSync(join(tmpdir(), "arc-handoff-"));
  const dump = "test archive";
  const keys = "BETTER_AUTH_SECRET='test-secret'\n";
  const manifest = {
    database: "ai_recruitment",
    sha256: {
      "data-keys.env": hash(keys),
      "database.dump": hash(dump),
    },
    version: 1,
  };
  const saveManifest = () =>
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  try {
    writeFileSync(join(directory, "database.dump"), dump);
    writeFileSync(join(directory, "data-keys.env"), keys);
    saveManifest();
    assert.equal(readBundle(directory).keys.BETTER_AUTH_SECRET, "test-secret");
    writeFileSync(join(directory, "database.dump"), "corrupted");
    assert.throws(() => readBundle(directory), /database.dump/);
    writeFileSync(join(directory, "database.dump"), dump);
    writeFileSync(join(directory, "data-keys.env"), `${keys}DATABASE_URL='remote'\n`);
    assert.throws(() => readBundle(directory), /data-keys.env/);
    manifest.sha256["data-keys.env"] = hash(`${keys}DATABASE_URL='remote'\n`);
    saveManifest();
    assert.throws(() => readBundle(directory), /不支持的字段/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
