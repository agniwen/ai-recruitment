import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";
import { getResumeParseQueue } from "@arc/resume-parse-queue/resume-parse";

const LEASE_MS = 60_000;
const registeredClients = new WeakSet<object>();
const ACQUIRE_SCRIPT = "return redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')";
const RENEW_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

// 同批次的相同文件只解析一次；等待期间不持有数据库事务/连接。
export async function withFileParseLock<T>(
  batchId: string,
  storageKey: string,
  run: (assertOwned: () => void) => Promise<T>,
): Promise<T> {
  const queue = getResumeParseQueue();
  const client = await queue.client;
  if (!registeredClients.has(client)) {
    client.defineCommand("arcAcquireFileParse", { lua: ACQUIRE_SCRIPT, numberOfKeys: 1 });
    client.defineCommand("arcRenewFileParse", { lua: RENEW_SCRIPT, numberOfKeys: 1 });
    client.defineCommand("arcReleaseFileParse", { lua: RELEASE_SCRIPT, numberOfKeys: 1 });
    registeredClients.add(client);
  }
  const key = queue.toKey(
    `file-parse:${batchId}:${createHash("sha256").update(storageKey).digest("hex")}`,
  );
  const token = randomUUID();
  while ((await client.runCommand("arcAcquireFileParse", [key, token, LEASE_MS])) !== "OK") {
    await delay(1000);
  }
  let lost = false;
  const assertOwned = () => {
    if (lost) {
      throw new Error("文件解析锁已失效，请重试上传任务。");
    }
  };
  const renew = async () => {
    try {
      if ((await client.runCommand("arcRenewFileParse", [key, token, LEASE_MS])) !== 1) {
        lost = true;
      }
    } catch {
      lost = true;
    }
  };
  const timer = setInterval(() => {
    void renew();
  }, LEASE_MS / 3);
  timer.unref();
  try {
    return await run(assertOwned);
  } finally {
    clearInterval(timer);
    await client.runCommand("arcReleaseFileParse", [key, token]);
  }
}
