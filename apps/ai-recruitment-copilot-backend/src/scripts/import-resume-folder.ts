import path from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { member, organization, user } from "@arc/db-schema/schema";
import type { Database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { MAX_BULK_BATCH_SIZE } from "@arc/shared/bulk-resume-upload";
import { loadStandaloneEnv } from "../standalone/env";
import {
  appendResumeFolderImportCheckpoint,
  assertResumeFolderImportStateCompatible,
  createResumeFolderImportState,
  listFilesNeedingUpload,
  loadResumeFolderImportState,
  mergeResumeFolderScan,
  planResumeFolderImportBatches,
  saveResumeFolderImportState,
  scanResumeDirectory,
  summarizeResumeFolderImportState,
} from "./import-resume-folder-lib";
import type {
  ResumeFolderImportBatchState,
  ResumeFolderImportDescriptor,
  ResumeFolderImportFileState,
  ResumeFolderImportState,
} from "./import-resume-folder-lib";

interface ImportCliOptions {
  batchSize: number;
  commit: boolean;
  concurrency: number;
  logEvery: number;
  logFile: string;
  recruitmentSourceDetail: string;
  rootPath: string;
  stateFile: string;
  userEmail: string | null;
  userId: string | null;
  verbose: boolean;
  workspaceSlug: string | null;
}

interface ImportActor {
  organizationId: string;
  organizationName: string;
  userEmail: string;
  userId: string;
}

interface SerializedStateSaver {
  checkpoint: (
    files: ResumeFolderImportFileState[],
    batches?: ResumeFolderImportBatchState[],
  ) => Promise<void>;
  snapshot: () => Promise<void>;
}

type LogLevel = "ERROR" | "INFO" | "WARN";

const HELP = `
批量导入目录中的简历到私有简历池，并标记为“历史简历”。默认只扫描；必须传 --commit 才会上传和入队。

用法：
  pnpm --filter @arc/ai-recruitment-copilot-backend import:resume-folder -- \\
    --root "/absolute/path/to/resumes" \\
    --workspace "workspace-slug" \\
    --user-email "operator@example.com" \\
    --commit

参数：
  --root <path>             简历根目录，递归扫描（必填）
  --workspace <slug>        工作区 slug；--commit 时必填
  --user-email <email>      操作人邮箱；与 --user-id 二选一
  --user-id <id>            操作人 ID；与 --user-email 二选一
  --commit                  真正上传并创建解析任务；缺省为 dry-run
  --state-file <path>       恢复状态日志，默认 <root>/.arc-resume-import-state.jsonl
  --log-file <path>         日志文件，默认 <state-file>.log
  --concurrency <n>         上传并发，默认 4，最大 16
  --batch-size <n>          每个解析批次文件数，默认 100，最大 100
  --log-every <n>           每处理多少个文件输出一次进度，默认 25
  --source-detail <text>    招聘来源详情，默认“文件夹批量导入”
  --verbose                 输出每个文件的跳过/成功日志
  --help                    显示帮助

恢复语义：
  - 上传成功后立即保存 contentHash/storageKey，重跑不会重复上传。
  - 批次 ID 在写数据库前保存，重跑只补建缺失批次或补入队。
  - 上传或入队失败会记录错误；再次执行同一命令会自动重试。
`;

function parsePositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} 必须是 1-${maximum} 的整数。`);
  }
  return parsed;
}

function parseRecruitmentSourceDetail(value: string | undefined): string {
  const detail = value?.trim() || "文件夹批量导入";
  if (detail.length > 500) {
    throw new Error("--source-detail 不能超过 500 个字符。");
  }
  return detail;
}

function parseCliOptions(argv: string[]): ImportCliOptions | null {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    allowPositionals: false,
    args: normalizedArgv,
    options: {
      "batch-size": { type: "string" },
      commit: { default: false, type: "boolean" },
      concurrency: { type: "string" },
      help: { default: false, short: "h", type: "boolean" },
      "log-every": { type: "string" },
      "log-file": { type: "string" },
      root: { type: "string" },
      "source-detail": { type: "string" },
      "state-file": { type: "string" },
      "user-email": { type: "string" },
      "user-id": { type: "string" },
      verbose: { default: false, type: "boolean" },
      workspace: { type: "string" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(HELP.trim());
    return null;
  }
  if (!values.root) {
    throw new Error("缺少 --root。使用 --help 查看用法。");
  }
  if (values["user-email"] && values["user-id"]) {
    throw new Error("--user-email 与 --user-id 只能提供一个。");
  }
  if (values.commit && (!values.workspace || !(values["user-email"] || values["user-id"]))) {
    throw new Error("--commit 时必须提供 --workspace，以及 --user-email/--user-id 之一。");
  }
  const rootPath = path.resolve(values.root);
  const stateFile = path.resolve(
    values["state-file"] ?? path.join(rootPath, ".arc-resume-import-state.jsonl"),
  );
  return {
    batchSize: parsePositiveInteger(
      values["batch-size"],
      "--batch-size",
      MAX_BULK_BATCH_SIZE,
      MAX_BULK_BATCH_SIZE,
    ),
    commit: values.commit,
    concurrency: parsePositiveInteger(values.concurrency, "--concurrency", 4, 16),
    logEvery: parsePositiveInteger(values["log-every"], "--log-every", 25, 10_000),
    logFile: path.resolve(values["log-file"] ?? `${stateFile}.log`),
    recruitmentSourceDetail: parseRecruitmentSourceDetail(values["source-detail"]),
    rootPath,
    stateFile,
    userEmail: values["user-email"]?.trim().toLowerCase() || null,
    userId: values["user-id"]?.trim() || null,
    verbose: values.verbose,
    workspaceSlug: values.workspace?.trim() || null,
  };
}

function serializeLogValue(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9._:/@-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function createLogger(logFile: string) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  return (level: LogLevel, event: string, data: Record<string, unknown> = {}): void => {
    const details = Object.entries(data)
      .map(([key, value]) => `${key}=${serializeLogValue(value)}`)
      .join(" ");
    const line = `[${new Date().toISOString()}] [${level}] ${event}${details ? ` ${details}` : ""}`;
    console.log(line);
    appendFileSync(logFile, `${line}\n`, { encoding: "utf-8", mode: 0o600 });
  };
}

async function resolveActor(
  database: Database,
  workspaceSlug: string,
  input: { userEmail: string | null; userId: string | null },
): Promise<ImportActor> {
  let actorCondition;
  if (input.userId) {
    actorCondition = eq(user.id, input.userId);
  } else if (input.userEmail) {
    actorCondition = eq(user.email, input.userEmail);
  } else {
    throw new Error("缺少操作人信息。");
  }
  const [row] = await database
    .select({
      organizationId: organization.id,
      organizationName: organization.name,
      userEmail: user.email,
      userId: user.id,
    })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(organization.slug, workspaceSlug), actorCondition))
    .limit(1);
  if (!row) {
    throw new Error("找不到工作区，或指定用户不是该工作区成员。");
  }
  return row;
}

function createSerializedStateSaver(
  stateFile: string,
  state: ResumeFolderImportState,
): SerializedStateSaver {
  let pending = Promise.resolve();
  function serialize(operation: () => Promise<void>): Promise<void> {
    const previous = pending;
    pending = (async () => {
      await previous;
      await operation();
    })();
    return pending;
  }
  return {
    checkpoint(files, batches = []) {
      const savedFiles = structuredClone(files);
      const savedBatches = structuredClone(batches);
      return serialize(() =>
        appendResumeFolderImportCheckpoint(stateFile, {
          batches: savedBatches,
          files: savedFiles,
        }),
      );
    },
    snapshot() {
      const savedState = structuredClone(state);
      return serialize(() => saveResumeFolderImportState(stateFile, savedState));
    },
  };
}

async function runConcurrent<T>(
  records: T[],
  concurrency: number,
  processRecord: (record: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < records.length) {
      const index = nextIndex;
      nextIndex += 1;
      const record = records[index];
      if (record) {
        await processRecord(record, index);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, () => worker()));
}

function scannedPath(rootPath: string, file: ResumeFolderImportFileState): string {
  return path.join(rootPath, ...file.relativePath.split("/"));
}

async function uploadFiles(input: {
  concurrency: number;
  files: ResumeFolderImportFileState[];
  log: ReturnType<typeof createLogger>;
  logEvery: number;
  organizationId: string;
  rootPath: string;
  saveState: SerializedStateSaver;
  state: ResumeFolderImportState;
  store: (
    file: File,
    userId: string,
    organizationId: string,
  ) => Promise<{ contentHash: string; storageKey: string } | null>;
  userId: string;
  verbose: boolean;
}): Promise<void> {
  let failed = 0;
  let finished = 0;
  let succeeded = 0;
  await runConcurrent(input.files, input.concurrency, async (file) => {
    file.attempts += 1;
    file.error = null;
    file.failureStage = null;
    try {
      const absolutePath = scannedPath(input.rootPath, file);
      const currentMetadata = await stat(absolutePath);
      if (currentMetadata.size !== file.fileSize || currentMetadata.mtimeMs !== file.modifiedAtMs) {
        throw new Error("文件在扫描后发生变化；请重新执行命令以刷新清单。");
      }
      const bytes = await readFile(absolutePath);
      const uploadFile = new globalThis.File([bytes], path.basename(file.relativePath), {
        type: file.mediaType,
      });
      const descriptor = await input.store(uploadFile, input.userId, input.organizationId);
      if (!descriptor) {
        throw new Error("对象存储或附件登记失败，未返回上传结果。");
      }
      file.descriptor = {
        ...descriptor,
        fileSize: file.fileSize,
        originalFileName: path.basename(file.relativePath),
      };
      file.status = "uploaded";
      succeeded += 1;
      if (input.verbose) {
        input.log("INFO", "upload.succeeded", {
          contentHash: descriptor.contentHash,
          path: file.relativePath,
          storageKey: descriptor.storageKey,
        });
      }
    } catch (error) {
      failed += 1;
      file.error = error instanceof Error ? error.message : String(error);
      file.failureStage = "upload";
      file.status = "failed";
      input.log("ERROR", "upload.failed", {
        attempt: file.attempts,
        error: file.error,
        path: file.relativePath,
      });
    } finally {
      finished += 1;
      await input.saveState.checkpoint([file]);
      if (finished % input.logEvery === 0 || finished === input.files.length) {
        input.log("INFO", "upload.progress", {
          failed,
          finished,
          remaining: input.files.length - finished,
          succeeded,
          total: input.files.length,
        });
      }
    }
  });
}

function batchFiles(
  state: ResumeFolderImportState,
  batch: ResumeFolderImportBatchState,
): (ResumeFolderImportFileState & { descriptor: ResumeFolderImportDescriptor })[] {
  return batch.filePaths.map((relativePath) => {
    const file = state.files[relativePath];
    if (!file?.descriptor) {
      throw new Error(`批次 ${batch.id} 缺少已上传文件：${relativePath}`);
    }
    return file as ResumeFolderImportFileState & { descriptor: ResumeFolderImportDescriptor };
  });
}

async function queueBatches(input: {
  actor: ImportActor;
  batches: ResumeFolderImportBatchState[];
  enqueue: (
    jobs: { batchId: string; itemId: string; organizationId: string; userId: string }[],
  ) => Promise<void>;
  insertBatch: (input: {
    batchId: string;
    dedupPolicy: "create";
    files: {
      contentHash: string;
      fileSize: number;
      originalFileName: string;
      storageKey: string;
    }[];
    jdMode: "none";
    jobDescriptionId: null;
    organizationId: string;
    recruitmentSource: "other";
    recruitmentSourceDetail: string;
    resumePoolScope: "private";
    sourceChannel: "historical_import";
    target: "resume_pool";
    userId: string;
  }) => Promise<string>;
  loadBatch: (
    batchId: string,
    organizationId: string,
    userId: string,
  ) => Promise<{
    batch: { status: string };
    items: { id: string; orderIndex: number; status: string }[];
  } | null>;
  log: ReturnType<typeof createLogger>;
  recruitmentSourceDetail: string;
  saveState: SerializedStateSaver;
  state: ResumeFolderImportState;
}): Promise<void> {
  let queued = 0;
  for (const batch of input.batches) {
    const files = batchFiles(input.state, batch);
    batch.attempts += 1;
    batch.error = null;
    try {
      let detail = await input.loadBatch(batch.id, input.actor.organizationId, input.actor.userId);
      if (!detail) {
        await input.insertBatch({
          batchId: batch.id,
          dedupPolicy: "create",
          files: files.map((file) => file.descriptor),
          jdMode: "none",
          jobDescriptionId: null,
          organizationId: input.actor.organizationId,
          recruitmentSource: "other",
          recruitmentSourceDetail: input.recruitmentSourceDetail,
          resumePoolScope: "private",
          sourceChannel: "historical_import",
          target: "resume_pool",
          userId: input.actor.userId,
        });
        detail = await input.loadBatch(batch.id, input.actor.organizationId, input.actor.userId);
      }
      if (!detail || detail.items.length !== files.length) {
        throw new Error("批次创建后无法读取，或明细数量不一致。");
      }
      const orderedItems = [...detail.items].toSorted(
        (left, right) => left.orderIndex - right.orderIndex,
      );
      for (const [index, file] of files.entries()) {
        file.itemId = orderedItems[index]?.id ?? null;
      }
      batch.status = "created";
      await input.saveState.checkpoint(files, [batch]);

      if (detail.batch.status === "cancelled") {
        throw new Error("数据库中的批次已取消；请使用新的状态文件重新导入这些文件。");
      }
      const jobs = orderedItems
        .filter((item) => item.status === "pending")
        .map((item) => ({
          batchId: batch.id,
          itemId: item.id,
          organizationId: input.actor.organizationId,
          userId: input.actor.userId,
        }));
      await input.enqueue(jobs);
      batch.status = "queued";
      for (const file of files) {
        file.error = null;
        file.failureStage = null;
        file.status = "queued";
      }
      queued += files.length;
      await input.saveState.checkpoint(files, [batch]);
      input.log("INFO", "batch.queued", {
        batchId: batch.id,
        files: files.length,
        pendingJobsAdded: jobs.length,
        queuedFilesThisRun: queued,
      });
    } catch (error) {
      batch.error = error instanceof Error ? error.message : String(error);
      batch.status = "failed";
      for (const file of files) {
        file.error = batch.error;
        file.failureStage = "batch";
      }
      await input.saveState.checkpoint(files, [batch]);
      input.log("ERROR", "batch.failed", {
        attempt: batch.attempts,
        batchId: batch.id,
        error: batch.error,
        files: files.length,
      });
    }
  }
}

async function ensureDirectory(rootPath: string): Promise<void> {
  const metadata = await stat(rootPath);
  if (!metadata.isDirectory()) {
    throw new Error(`--root 不是目录：${rootPath}`);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options) {
    return;
  }
  await ensureDirectory(options.rootPath);
  const log = createLogger(options.logFile);
  log("INFO", "import.started", {
    commit: options.commit,
    logFile: options.logFile,
    rootPath: options.rootPath,
    sourceChannel: "historical_import",
    stateFile: options.stateFile,
  });

  const scannedFiles = await scanResumeDirectory(options.rootPath, [
    options.stateFile,
    options.logFile,
  ]);
  const validCount = scannedFiles.filter((file) => !file.invalidReason).length;
  const invalidFiles = scannedFiles.filter((file) => file.invalidReason);
  log("INFO", "scan.completed", {
    invalid: invalidFiles.length,
    total: scannedFiles.length,
    valid: validCount,
  });
  for (const file of invalidFiles) {
    log("WARN", "scan.invalid", { path: file.relativePath, reason: file.invalidReason });
  }
  if (!options.commit) {
    log("INFO", "dry_run.completed", {
      message: "未上传、未写数据库；确认后增加 --commit。",
    });
    return;
  }

  loadStandaloneEnv();
  const [{ closeDatabase, db, pingDatabase }, queueApi, batchDao, storageApi] = await Promise.all([
    import("@arc/ai-recruitment-copilot-backend/lib/server/db"),
    import("@arc/resume-parse-queue/resume-parse"),
    import("@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resume-upload-batches/dao/batches"),
    import("@arc/ai-recruitment-copilot-backend/server/routes/interview/utils"),
  ]);
  try {
    if (!queueApi.isResumeParseQueueConfigured()) {
      throw new Error("未配置 REDIS_URL，无法创建解析任务。");
    }
    const { workspaceSlug } = options;
    if (!workspaceSlug) {
      throw new Error("缺少 --workspace。");
    }
    await pingDatabase();
    const actor = await resolveActor(db, workspaceSlug, {
      userEmail: options.userEmail,
      userId: options.userId,
    });
    log("INFO", "actor.resolved", {
      organizationId: actor.organizationId,
      organizationName: actor.organizationName,
      userEmail: actor.userEmail,
      userId: actor.userId,
      workspaceSlug,
    });

    const stateInput = {
      organizationId: actor.organizationId,
      recruitmentSourceDetail: options.recruitmentSourceDetail,
      rootPath: options.rootPath,
      userId: actor.userId,
      workspaceSlug,
    };
    const existingState = await loadResumeFolderImportState(options.stateFile);
    const state = existingState ?? createResumeFolderImportState(stateInput);
    if (existingState) {
      assertResumeFolderImportStateCompatible(existingState, stateInput);
      log("INFO", "state.resumed", {
        createdAt: existingState.createdAt,
        runId: existingState.runId,
      });
    } else {
      log("INFO", "state.created", { runId: state.runId });
    }
    const mergeResult = mergeResumeFolderScan(state, scannedFiles);
    if (mergeResult.conflicts.length > 0) {
      for (const relativePath of mergeResult.conflicts) {
        log("ERROR", "scan.conflict", {
          path: relativePath,
          reason: "文件在上传成功后发生变化",
        });
      }
      throw new Error(
        `发现 ${mergeResult.conflicts.length} 个已上传后被修改的文件；请恢复原文件或指定新的 --state-file。`,
      );
    }
    const saveState = createSerializedStateSaver(options.stateFile, state);
    await saveState.snapshot();
    log("INFO", "state.reconciled", { ...mergeResult });

    const filesToUpload = listFilesNeedingUpload(state);
    const alreadyStored = Object.values(state.files).filter((file) =>
      ["uploaded", "batch_planned", "queued"].includes(file.status),
    ).length;
    log("INFO", "upload.plan", {
      alreadyStoredSkipped: alreadyStored,
      concurrency: options.concurrency,
      retryOrNew: filesToUpload.length,
    });
    if (options.verbose) {
      for (const file of Object.values(state.files).filter(
        (record) => record.status === "queued",
      )) {
        log("INFO", "upload.skipped", { path: file.relativePath, reason: "already_queued" });
      }
    }
    await uploadFiles({
      concurrency: options.concurrency,
      files: filesToUpload,
      log,
      logEvery: options.logEvery,
      organizationId: actor.organizationId,
      rootPath: options.rootPath,
      saveState,
      state,
      store: storageApi.storeResumeObjectOnly,
      userId: actor.userId,
      verbose: options.verbose,
    });

    const planned = planResumeFolderImportBatches(state, options.batchSize);
    if (planned.length > 0) {
      await saveState.snapshot();
      log("INFO", "batch.planned", {
        batchSize: options.batchSize,
        batches: planned.length,
        files: planned.reduce((sum, batch) => sum + batch.filePaths.length, 0),
      });
    }
    const batchesToQueue = Object.values(state.batches).filter(
      (batch) => batch.status !== "queued",
    );
    await queueBatches({
      actor,
      batches: batchesToQueue,
      enqueue: queueApi.enqueueResumeParseJobs,
      insertBatch: batchDao.insertBatchWithItems,
      loadBatch: batchDao.loadBatchDetail,
      log,
      recruitmentSourceDetail: options.recruitmentSourceDetail,
      saveState,
      state,
    });

    const summary = summarizeResumeFolderImportState(state);
    log("INFO", "import.completed", summary);
    if (summary.failed > 0 || summary.batch_planned > 0 || summary.discovered > 0) {
      process.exitCode = 1;
      log("WARN", "import.recovery_required", {
        message: "存在未完成项目；修复外部依赖后使用同一命令和状态文件重跑。",
      });
    }
  } finally {
    await queueApi.closeResumeParseQueue();
    await closeDatabase();
  }
}

try {
  await main();
} catch (error) {
  console.error(`[resume-folder-import] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
