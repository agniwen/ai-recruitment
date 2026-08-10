import path from "node:path";
import { mkdir, open, opendir, readFile, rename, stat } from "node:fs/promises";
import { MAX_BULK_BATCH_SIZE, MAX_RESUME_FILE_SIZE_BYTES } from "@arc/shared/bulk-resume-upload";
import {
  getResumeDocumentKind,
  isSupportedResumeDocumentInput,
  resumeDocumentFormats,
} from "@arc/shared/resume-documents";

export const RESUME_FOLDER_IMPORT_STATE_VERSION = 1;

export type ResumeFolderImportMode = "local" | "remote";

export type ImportFileStatus =
  | "discovered"
  | "uploaded"
  | "batch_planned"
  | "queued"
  | "failed"
  | "invalid";

export interface ResumeFolderImportDescriptor {
  contentHash: string;
  fileSize: number;
  originalFileName: string;
  storageKey: string;
}

export interface ResumeFolderImportFileState {
  attempts: number;
  batchId: string | null;
  descriptor: ResumeFolderImportDescriptor | null;
  error: string | null;
  failureStage: "upload" | "batch" | null;
  fileSize: number;
  itemId: string | null;
  mediaType: string;
  modifiedAtMs: number;
  relativePath: string;
  status: ImportFileStatus;
}

export interface ResumeFolderImportBatchState {
  attempts: number;
  error: string | null;
  filePaths: string[];
  id: string;
  status: "planned" | "created" | "queued" | "failed";
}

export interface ResumeFolderImportState {
  batches: Record<string, ResumeFolderImportBatchState>;
  configuration: {
    importMode: ResumeFolderImportMode;
    organizationId: string;
    recruitmentSourceDetail: string;
    userId: string;
    workspaceSlug: string;
  };
  createdAt: string;
  files: Record<string, ResumeFolderImportFileState>;
  rootPath: string;
  runId: string;
  updatedAt: string;
  version: typeof RESUME_FOLDER_IMPORT_STATE_VERSION;
}

export interface ResumeFolderImportCheckpoint {
  batches?: ResumeFolderImportBatchState[];
  files?: ResumeFolderImportFileState[];
  timestamp: string;
  type: "checkpoint";
}

interface ResumeFolderImportSnapshot {
  state: ResumeFolderImportState;
  type: "snapshot";
}

export interface ScannedResumeFile {
  absolutePath: string;
  fileSize: number;
  invalidReason: string | null;
  mediaType: string;
  modifiedAtMs: number;
  relativePath: string;
}

interface CreateImportStateInput {
  importMode: ResumeFolderImportMode;
  organizationId: string;
  recruitmentSourceDetail: string;
  rootPath: string;
  runId?: string;
  userId: string;
  workspaceSlug: string;
}

interface MergeScanResult {
  added: number;
  conflicts: string[];
  invalid: number;
  missing: number;
  unchanged: number;
}

function mediaTypeForFile(fileName: string): string {
  const kind = getResumeDocumentKind({ fileName });
  return kind ? (resumeDocumentFormats[kind].mediaTypes[0] ?? "application/octet-stream") : "";
}

function toRelativePath(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

function invalidReasonForFile(fileName: string, fileSize: number): string | null {
  if (!isSupportedResumeDocumentInput({ fileName })) {
    return "不支持的文件格式";
  }
  if (fileSize <= 0) {
    return "文件为空";
  }
  if (fileSize > MAX_RESUME_FILE_SIZE_BYTES) {
    return "文件超过 20MB";
  }
  return null;
}

export async function scanResumeDirectory(
  rootPath: string,
  excludedPaths: string[] = [],
): Promise<ScannedResumeFile[]> {
  const normalizedRoot = path.resolve(rootPath);
  const excluded = new Set(excludedPaths.map((entry) => path.resolve(entry)));
  const files: ScannedResumeFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (excluded.has(path.resolve(absolutePath)) || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const metadata = await stat(absolutePath);
      files.push({
        absolutePath,
        fileSize: metadata.size,
        invalidReason: invalidReasonForFile(entry.name, metadata.size),
        mediaType: mediaTypeForFile(entry.name),
        modifiedAtMs: metadata.mtimeMs,
        relativePath: toRelativePath(normalizedRoot, absolutePath),
      });
    }
  }

  await visit(normalizedRoot);
  return files.toSorted((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-CN"),
  );
}

export function createResumeFolderImportState({
  importMode,
  organizationId,
  recruitmentSourceDetail,
  rootPath,
  runId = crypto.randomUUID(),
  userId,
  workspaceSlug,
}: CreateImportStateInput): ResumeFolderImportState {
  const now = new Date().toISOString();
  return {
    batches: {},
    configuration: {
      importMode,
      organizationId,
      recruitmentSourceDetail,
      userId,
      workspaceSlug,
    },
    createdAt: now,
    files: {},
    rootPath: path.resolve(rootPath),
    runId,
    updatedAt: now,
    version: RESUME_FOLDER_IMPORT_STATE_VERSION,
  };
}

export function assertResumeFolderImportStateCompatible(
  state: ResumeFolderImportState,
  expected: CreateImportStateInput,
): void {
  if (state.version !== RESUME_FOLDER_IMPORT_STATE_VERSION) {
    throw new Error(`不支持的状态文件版本：${state.version}`);
  }
  const mismatches = [
    ["rootPath", state.rootPath, path.resolve(expected.rootPath)],
    ["importMode", state.configuration.importMode, expected.importMode],
    ["workspaceSlug", state.configuration.workspaceSlug, expected.workspaceSlug],
    ["organizationId", state.configuration.organizationId, expected.organizationId],
    ["userId", state.configuration.userId, expected.userId],
    [
      "recruitmentSourceDetail",
      state.configuration.recruitmentSourceDetail,
      expected.recruitmentSourceDetail,
    ],
  ].filter(([, actual, wanted]) => actual !== wanted);
  if (mismatches.length > 0) {
    throw new Error(
      `状态文件与本次参数不一致：${mismatches
        .map(([name, actual, wanted]) => `${name}=${actual}（期望 ${wanted}）`)
        .join("，")}`,
    );
  }
}

export function mergeResumeFolderScan(
  state: ResumeFolderImportState,
  scannedFiles: ScannedResumeFile[],
): MergeScanResult {
  let added = 0;
  const conflicts: string[] = [];
  let invalid = 0;
  let unchanged = 0;
  const scannedPaths = new Set(scannedFiles.map((file) => file.relativePath));

  for (const file of scannedFiles) {
    const current = state.files[file.relativePath];
    if (!current) {
      state.files[file.relativePath] = {
        attempts: 0,
        batchId: null,
        descriptor: null,
        error: file.invalidReason,
        failureStage: null,
        fileSize: file.fileSize,
        itemId: null,
        mediaType: file.mediaType,
        modifiedAtMs: file.modifiedAtMs,
        relativePath: file.relativePath,
        status: file.invalidReason ? "invalid" : "discovered",
      };
      added += 1;
      if (file.invalidReason) {
        invalid += 1;
      }
      continue;
    }

    const changed =
      current.fileSize !== file.fileSize || current.modifiedAtMs !== file.modifiedAtMs;
    if (!changed) {
      unchanged += 1;
      if (current.status === "invalid") {
        invalid += 1;
      }
      continue;
    }
    if (["uploaded", "batch_planned", "queued"].includes(current.status)) {
      conflicts.push(file.relativePath);
      continue;
    }
    Object.assign(current, {
      attempts: 0,
      batchId: null,
      descriptor: null,
      error: file.invalidReason,
      failureStage: null,
      fileSize: file.fileSize,
      itemId: null,
      mediaType: file.mediaType,
      modifiedAtMs: file.modifiedAtMs,
      status: file.invalidReason ? "invalid" : "discovered",
    });
    if (file.invalidReason) {
      invalid += 1;
    }
  }

  return {
    added,
    conflicts,
    invalid,
    missing: Object.keys(state.files).filter((relativePath) => !scannedPaths.has(relativePath))
      .length,
    unchanged,
  };
}

export function listFilesNeedingUpload(
  state: ResumeFolderImportState,
): ResumeFolderImportFileState[] {
  return Object.values(state.files).filter(
    (file) =>
      file.status === "discovered" || (file.status === "failed" && file.failureStage === "upload"),
  );
}

export function planResumeFolderImportBatches(
  state: ResumeFolderImportState,
  batchSize: number,
  createId: () => string = () => crypto.randomUUID(),
): ResumeFolderImportBatchState[] {
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > MAX_BULK_BATCH_SIZE) {
    throw new Error(`batchSize 必须是 1-${MAX_BULK_BATCH_SIZE} 的整数。`);
  }
  const available = Object.values(state.files).filter(
    (file) => file.status === "uploaded" && !file.batchId && file.descriptor,
  );
  const planned: ResumeFolderImportBatchState[] = [];
  for (let index = 0; index < available.length; index += batchSize) {
    const chunk = available.slice(index, index + batchSize);
    const id = createId();
    const batch: ResumeFolderImportBatchState = {
      attempts: 0,
      error: null,
      filePaths: chunk.map((file) => file.relativePath),
      id,
      status: "planned",
    };
    state.batches[id] = batch;
    for (const file of chunk) {
      file.batchId = id;
      file.status = "batch_planned";
    }
    planned.push(batch);
  }
  return planned;
}

export function summarizeResumeFolderImportState(state: ResumeFolderImportState) {
  const counts: Record<ImportFileStatus, number> = {
    batch_planned: 0,
    discovered: 0,
    failed: 0,
    invalid: 0,
    queued: 0,
    uploaded: 0,
  };
  for (const file of Object.values(state.files)) {
    counts[file.status] += 1;
  }
  return { ...counts, total: Object.keys(state.files).length };
}

export async function loadResumeFolderImportState(
  statePath: string,
): Promise<ResumeFolderImportState | null> {
  try {
    const contents = await readFile(statePath, "utf-8");
    try {
      const legacy = JSON.parse(contents) as ResumeFolderImportState;
      if (legacy.version === RESUME_FOLDER_IMPORT_STATE_VERSION) {
        return normalizeResumeFolderImportState(legacy);
      }
    } catch {
      // JSONL journals are intentionally not a single JSON document.
    }
    let state: ResumeFolderImportState | null = null;
    for (const line of contents.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const entry = JSON.parse(line) as ResumeFolderImportCheckpoint | ResumeFolderImportSnapshot;
      if (entry.type === "snapshot") {
        state = normalizeResumeFolderImportState(entry.state);
        continue;
      }
      if (!state) {
        throw new Error("状态日志缺少 snapshot 起始记录。");
      }
      for (const file of entry.files ?? []) {
        state.files[file.relativePath] = file;
      }
      for (const batch of entry.batches ?? []) {
        state.batches[batch.id] = batch;
      }
      state.updatedAt = entry.timestamp;
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeResumeFolderImportState(state: ResumeFolderImportState): ResumeFolderImportState {
  const importMode = state.configuration.importMode === "local" ? "local" : "remote";
  return {
    ...state,
    configuration: {
      ...state.configuration,
      importMode,
    },
  };
}

export async function saveResumeFolderImportState(
  statePath: string,
  state: ResumeFolderImportState,
): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    const snapshot: ResumeFolderImportSnapshot = { state, type: "snapshot" };
    await handle.writeFile(`${JSON.stringify(snapshot)}\n`, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, statePath);
}

export async function appendResumeFolderImportCheckpoint(
  statePath: string,
  checkpoint: Omit<ResumeFolderImportCheckpoint, "timestamp" | "type">,
): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  const entry: ResumeFolderImportCheckpoint = {
    ...checkpoint,
    timestamp: new Date().toISOString(),
    type: "checkpoint",
  };
  const handle = await open(statePath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
