import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { member, organization, resumeUploadBatchItem, user } from "@arc/db-schema/schema";
import { db, closeDatabase } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { listStorageObjects } from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import {
  insertBatchWithItems,
  loadBatchDetail,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches";
import {
  enqueueResumeParseJobs,
  closeResumeParseQueue,
  isResumeParseQueueConfigured,
  RESUME_PARSE_HISTORICAL_QUEUE_NAME,
} from "@arc/resume-parse-queue/resume-parse";
import { loadStandaloneEnv } from "../standalone/env";
import {
  isSupportedLegacyResumeKey,
  legacyResumeFileName,
  LEGACY_RESUME_PREFIXES,
} from "./legacy-resume-import-files";
const BATCH_SIZE = 100;

async function resolveActor(workspaceSlug: string, email: string) {
  const [actor] = await db
    .select({ organizationId: organization.id, userId: user.id })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(organization.slug, workspaceSlug), eq(user.email, email)))
    .limit(1);
  if (!actor) {
    throw new Error("指定邮箱不是该工作区成员。");
  }
  return actor;
}

async function discover() {
  const files: {
    contentHash: null;
    fileSize: number;
    originalFileName: string;
    sourceFolder: string;
    storageKey: string;
  }[] = [];
  for (const prefix of LEGACY_RESUME_PREFIXES) {
    let continuationToken: string | undefined;
    do {
      const page = await listStorageObjects({ continuationToken, prefix });
      for (const object of page.objects) {
        const originalFileName = legacyResumeFileName(object.key);
        if (!isSupportedLegacyResumeKey(originalFileName)) {
          continue;
        }
        files.push({
          contentHash: null,
          fileSize: object.size,
          originalFileName,
          sourceFolder: prefix,
          storageKey: object.key,
        });
      }
      continuationToken = page.continuationToken ?? undefined;
    } while (continuationToken);
  }
  return files;
}

async function main() {
  const { values } = parseArgs({
    options: {
      commit: { default: false, type: "boolean" },
      "user-email": { type: "string" },
      workspace: { type: "string" },
    },
    strict: true,
  });
  loadStandaloneEnv();
  if (values.commit && process.env.ENABLE_LEGACY_PARSE?.trim().toLowerCase() !== "true") {
    throw new Error("ENABLE_LEGACY_PARSE 必须设置为 true 才能创建历史简历任务。");
  }
  if (!(values.workspace && values["user-email"])) {
    throw new Error("必须提供 --workspace 和 --user-email。");
  }
  const actor = await resolveActor(values.workspace, values["user-email"]);
  const discovered = await discover();
  const existing = new Set<string>();
  for (let offset = 0; offset < discovered.length; offset += 500) {
    const keys = discovered.slice(offset, offset + 500).map((file) => file.storageKey);
    const rows = await db
      .select({ storageKey: resumeUploadBatchItem.storageKey })
      .from(resumeUploadBatchItem)
      .where(
        and(
          eq(resumeUploadBatchItem.organizationId, actor.organizationId),
          inArray(resumeUploadBatchItem.storageKey, keys),
        ),
      );
    for (const row of rows) {
      existing.add(row.storageKey);
    }
  }
  const pending = discovered.filter((file) => !existing.has(file.storageKey));
  console.info("[legacy-resume-import] discovery", {
    alreadyRegistered: existing.size,
    selected: discovered.length,
    toCreate: pending.length,
  });
  if (!values.commit) {
    console.info("[legacy-resume-import] dry run only; add --commit to create jobs");
    return;
  }
  if (!isResumeParseQueueConfigured()) {
    throw new Error("REDIS_URL 未配置。");
  }
  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const files = pending.slice(offset, offset + BATCH_SIZE);
    const batchId = createHash("sha256")
      .update(`${actor.organizationId}:${files[0]?.storageKey ?? offset}`)
      .digest("hex")
      .slice(0, 32);
    await insertBatchWithItems({
      batchId,
      dedupPolicy: "create",
      files,
      jdMode: "none",
      jobDescriptionId: null,
      organizationId: actor.organizationId,
      recruitmentSourceDetail: "legacy-upload 历史简历导入",
      resumePoolScope: "public",
      sourceChannel: "historical_import",
      target: "resume_pool",
      userId: actor.userId,
    });
    const detail = await loadBatchDetail(batchId, actor.organizationId, actor.userId);
    if (!detail) {
      throw new Error(`创建历史导入批次后无法读取：${batchId}`);
    }
    await enqueueResumeParseJobs(
      detail.items.map((item) => ({
        batchId,
        itemId: item.id,
        organizationId: actor.organizationId,
        userId: actor.userId,
      })),
      { queueName: RESUME_PARSE_HISTORICAL_QUEUE_NAME },
    );
    console.info("[legacy-resume-import] batch queued", { batchId, count: files.length });
  }
}

try {
  await main();
} finally {
  await closeResumeParseQueue();
  await closeDatabase();
}
