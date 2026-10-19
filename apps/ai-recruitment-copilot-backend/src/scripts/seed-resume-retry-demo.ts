import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import {
  member,
  organization,
  resumePoolItem,
  resumeUploadBatch,
  resumeUploadBatchItem,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import {
  closeResumeParseQueue,
  defaultResumeParseJobOptions,
  enqueueResumeParseJobs,
  isResumeParseQueueConfigured,
} from "@arc/resume-parse-queue/resume-parse";
import { loadStandaloneEnv } from "../standalone/env";

// Creates new, intentionally missing-file fixtures only in local DB/Redis.
// pnpm --filter @arc/ai-recruitment-copilot-backend exec tsx src/scripts/seed-resume-retry-demo.ts --workspace <slug> --user-id <id> --commit
loadStandaloneEnv();
const { values } = parseArgs({
  options: {
    commit: { default: false, type: "boolean" },
    "user-id": { type: "string" },
    workspace: { type: "string" },
  },
});

async function main() {
  if (!values.workspace || !values["user-id"]) {
    throw new Error("必须指定 --workspace 和 --user-id。");
  }
  for (const key of ["DATABASE_URL", "REDIS_URL"] as const) {
    const endpoint = new URL(process.env[key] ?? "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
      throw new Error("测试脚本仅允许连接本机数据库和 Redis。");
    }
  }
  if (!isResumeParseQueueConfigured()) {
    throw new Error("Redis 未配置。");
  }
  const { db, closeDatabase } = await import("../lib/server/db");
  try {
    const [actor] = await db
      .select({
        organizationId: organization.id,
        organizationName: organization.name,
        role: member.role,
        userId: user.id,
        userName: user.name,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(organization.slug, values.workspace), eq(user.id, values["user-id"])))
      .limit(1);
    if (!actor) {
      throw new Error("用户不属于指定工作区。");
    }
    const runId = `retry-demo-${new Date().toISOString().replaceAll(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 6)}`;
    const fixtures = [
      { label: "单条重跑", target: "resume_library" as const },
      { label: "批量重跑", target: "resume_library" as const },
      { label: "简历池重试", target: "resume_pool" as const },
    ].map((scenario, index) => ({
      ...scenario,
      batchId: `${runId}-batch-${index + 1}`,
      fileName: `【重试测试】${scenario.label}-${runId}.pdf`,
      itemId: `${runId}-item-${index + 1}`,
      recordId: `${runId}-record-${index + 1}`,
      storageKey: `retry-demo/missing/${runId}/${index + 1}.pdf`,
    }));
    console.log(
      JSON.stringify(
        {
          actor,
          attempts: defaultResumeParseJobOptions().attempts,
          committed: values.commit,
          fixtures,
          runId,
        },
        null,
        2,
      ),
    );
    if (!values.commit) {
      return;
    }
    await db.transaction(async (tx) => {
      for (const fixture of fixtures) {
        const common = {
          candidateName: `【重试测试】${fixture.label}`,
          createdBy: actor.userId,
          id: fixture.recordId,
          organizationId: actor.organizationId,
          resumeFileName: fixture.fileName,
          resumeParseStatus: "queued" as const,
          resumeStorageKey: fixture.storageKey,
        };
        await (fixture.target === "resume_library"
          ? tx.insert(studioInterview).values({ ...common, createdByRole: actor.role })
          : tx.insert(resumePoolItem).values({ ...common, scope: "private" }));
        await tx.insert(resumeUploadBatch).values({
          createdBy: actor.userId,
          createdByRole: actor.role,
          dedupPolicy: "create",
          id: fixture.batchId,
          jdMode: "none",
          organizationId: actor.organizationId,
          recruitmentSourceDetail: `重试功能测试 ${runId}`,
          resumePoolScope: fixture.target === "resume_pool" ? "private" : null,
          status: "pending",
          target: fixture.target,
          totalCount: 1,
        });
        await tx.insert(resumeUploadBatchItem).values({
          batchId: fixture.batchId,
          fileSize: 1024,
          id: fixture.itemId,
          orderIndex: 0,
          organizationId: actor.organizationId,
          originalFileName: fixture.fileName,
          poolItemId: fixture.target === "resume_pool" ? fixture.recordId : null,
          queuedAt: new Date(),
          resumeRecordId: fixture.target === "resume_library" ? fixture.recordId : null,
          status: "pending",
          storageKey: fixture.storageKey,
        });
      }
    });
    await enqueueResumeParseJobs(
      fixtures.map((fixture) => ({
        batchId: fixture.batchId,
        itemId: fixture.itemId,
        organizationId: actor.organizationId,
        userId: actor.userId,
      })),
    );
    console.log("已新增并入队 3 条重试测试任务；默认约 30 秒后完成自动重试。");
  } finally {
    await closeResumeParseQueue();
    await closeDatabase();
  }
}

try {
  await main();
} catch {
  console.error("测试任务创建失败；请检查工作区、用户和本地服务连接。");
  process.exitCode = 1;
}
