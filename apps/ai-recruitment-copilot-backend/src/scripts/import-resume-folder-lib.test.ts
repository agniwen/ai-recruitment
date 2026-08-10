import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendResumeFolderImportCheckpoint,
  assertResumeFolderImportStateCompatible,
  createLocalParseProgressTracker,
  createResumeFolderImportState,
  formatDurationMs,
  listFilesNeedingUpload,
  loadResumeFolderImportState,
  mergeResumeFolderScan,
  planResumeFolderImportBatches,
  saveResumeFolderImportState,
  scanResumeDirectory,
} from "./import-resume-folder-lib";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "arc-resume-import-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeState(rootPath: string) {
  return createResumeFolderImportState({
    importMode: "remote",
    organizationId: "org-1",
    recruitmentSourceDetail: "历史简历导入",
    resumePoolScope: "public",
    rootPath,
    runId: "run-1",
    userId: "user-1",
    workspaceSlug: "workspace-1",
  });
}

describe("resume folder import state", () => {
  it("only accepts PDF files and skips other formats", async () => {
    const rootPath = await makeTemporaryDirectory();
    await writeFile(path.join(rootPath, "keep.pdf"), "pdf");
    await writeFile(path.join(rootPath, "skip.docx"), "docx");
    await writeFile(path.join(rootPath, "skip.png"), "png");
    await writeFile(path.join(rootPath, "notes.txt"), "txt");

    const scanned = await scanResumeDirectory(rootPath);
    const byPath = Object.fromEntries(scanned.map((file) => [file.relativePath, file]));

    expect(byPath["keep.pdf"]?.invalidReason).toBeNull();
    expect(byPath["skip.docx"]?.invalidReason).toMatch(/PDF|跳过/);
    expect(byPath["skip.png"]?.invalidReason).toMatch(/PDF|跳过/);
    expect(byPath["notes.txt"]?.invalidReason).toMatch(/PDF|跳过/);

    const state = makeState(rootPath);
    const merged = mergeResumeFolderScan(state, scanned);
    expect(merged.invalid).toBe(3);
    expect(listFilesNeedingUpload(state).map((file) => file.relativePath)).toEqual(["keep.pdf"]);
  });

  it("keeps uploaded and queued files out of a resumed upload", async () => {
    const rootPath = await makeTemporaryDirectory();
    await writeFile(path.join(rootPath, "a.pdf"), "a");
    await writeFile(path.join(rootPath, "b.pdf"), "b");
    const scanned = await scanResumeDirectory(rootPath);
    const state = makeState(rootPath);
    mergeResumeFolderScan(state, scanned);
    const first = state.files["a.pdf"];
    const second = state.files["b.pdf"];
    if (!(first && second)) {
      throw new Error("scan did not return the expected fixtures");
    }

    first.status = "uploaded";
    first.descriptor = {
      contentHash: "hash-a",
      fileSize: 1,
      originalFileName: "a.pdf",
      storageKey: "storage/a.pdf",
    };
    second.status = "failed";
    second.failureStage = "upload";

    expect(listFilesNeedingUpload(state).map((file) => file.relativePath)).toEqual(["b.pdf"]);
  });

  it("persists planned batch ids before database creation and does not plan them twice", async () => {
    const rootPath = await makeTemporaryDirectory();
    const statePath = path.join(rootPath, ".state.jsonl");
    const state = makeState(rootPath);
    for (const name of ["a.pdf", "b.pdf", "c.pdf"]) {
      state.files[name] = {
        attempts: 1,
        batchId: null,
        descriptor: {
          contentHash: `hash-${name}`,
          fileSize: 1,
          originalFileName: name,
          storageKey: `storage/${name}`,
        },
        error: null,
        failureStage: null,
        fileSize: 1,
        itemId: null,
        mediaType: "application/pdf",
        modifiedAtMs: 1,
        relativePath: name,
        status: "uploaded",
      };
    }

    const ids = ["batch-1", "batch-2"];
    const planned = planResumeFolderImportBatches(state, 2, () => {
      const id = ids.shift();
      if (!id) {
        throw new Error("missing batch id fixture");
      }
      return id;
    });
    await saveResumeFolderImportState(statePath, state);
    const restored = await loadResumeFolderImportState(statePath);
    if (!restored) {
      throw new Error("state was not restored");
    }

    expect(planned.map((batch) => batch.id)).toEqual(["batch-1", "batch-2"]);
    expect(restored?.files["a.pdf"]?.batchId).toBe("batch-1");
    expect(restored?.files["c.pdf"]?.batchId).toBe("batch-2");
    expect(planResumeFolderImportBatches(restored, 2)).toEqual([]);
    const stateContents = await readFile(statePath, "utf-8");
    const [firstLine] = stateContents.split("\n");
    expect(JSON.parse(firstLine ?? "{}")).toMatchObject({
      state: { runId: "run-1" },
      type: "snapshot",
    });
  });

  it("replays append-only file checkpoints after the snapshot", async () => {
    const rootPath = await makeTemporaryDirectory();
    const statePath = path.join(rootPath, ".state.jsonl");
    const state = makeState(rootPath);
    state.files["resume.pdf"] = {
      attempts: 0,
      batchId: null,
      descriptor: null,
      error: null,
      failureStage: null,
      fileSize: 1,
      itemId: null,
      mediaType: "application/pdf",
      modifiedAtMs: 1,
      relativePath: "resume.pdf",
      status: "discovered",
    };
    await saveResumeFolderImportState(statePath, state);
    const uploaded = {
      ...state.files["resume.pdf"],
      attempts: 1,
      descriptor: {
        contentHash: "hash",
        fileSize: 1,
        originalFileName: "resume.pdf",
        storageKey: "storage/resume.pdf",
      },
      status: "uploaded" as const,
    };
    await appendResumeFolderImportCheckpoint(statePath, { files: [uploaded] });

    const restored = await loadResumeFolderImportState(statePath);

    expect(restored?.files["resume.pdf"]?.status).toBe("uploaded");
    expect(restored?.files["resume.pdf"]?.descriptor?.contentHash).toBe("hash");
  });

  it("reports a conflict when an already uploaded source file changes", async () => {
    const rootPath = await makeTemporaryDirectory();
    const state = makeState(rootPath);
    state.files["resume.pdf"] = {
      attempts: 1,
      batchId: null,
      descriptor: {
        contentHash: "old-hash",
        fileSize: 10,
        originalFileName: "resume.pdf",
        storageKey: "storage/resume.pdf",
      },
      error: null,
      failureStage: null,
      fileSize: 10,
      itemId: null,
      mediaType: "application/pdf",
      modifiedAtMs: 1,
      relativePath: "resume.pdf",
      status: "uploaded",
    };

    const result = mergeResumeFolderScan(state, [
      {
        absolutePath: path.join(rootPath, "resume.pdf"),
        fileSize: 11,
        invalidReason: null,
        mediaType: "application/pdf",
        modifiedAtMs: 2,
        relativePath: "resume.pdf",
      },
    ]);

    expect(result.conflicts).toEqual(["resume.pdf"]);
    expect(state.files["resume.pdf"]?.descriptor?.contentHash).toBe("old-hash");
  });

  it("rejects resuming a remote state file with local mode", () => {
    const rootPath = "/tmp/resumes";
    const state = makeState(rootPath);
    expect(() =>
      assertResumeFolderImportStateCompatible(state, {
        importMode: "local",
        organizationId: "org-1",
        recruitmentSourceDetail: "历史简历导入",
        resumePoolScope: "public",
        rootPath,
        userId: "user-1",
        workspaceSlug: "workspace-1",
      }),
    ).toThrow(/importMode/);
  });

  it("defaults legacy state files without importMode to remote", async () => {
    const rootPath = await makeTemporaryDirectory();
    const statePath = path.join(rootPath, ".state.jsonl");
    const legacy = makeState(rootPath);
    delete (legacy.configuration as { importMode?: string }).importMode;
    await writeFile(statePath, `${JSON.stringify({ state: legacy, type: "snapshot" })}\n`, "utf-8");

    const restored = await loadResumeFolderImportState(statePath);
    expect(restored?.configuration.importMode).toBe("remote");
  });
});

describe("local parse progress tracker", () => {
  it("formats durations for logs", () => {
    expect(formatDurationMs(800)).toBe("800ms");
    expect(formatDurationMs(1500)).toBe("1.5s");
    expect(formatDurationMs(65_000)).toBe("1m5s");
  });

  it("tracks remaining totals and batch remaining after each item", () => {
    let now = 1000;
    const tracker = createLocalParseProgressTracker({
      batchPendingCounts: { "batch-a": 3, "batch-b": 2 },
      now: () => now,
      total: 5,
    });

    now = 4000;
    const first = tracker.record({
      batchId: "batch-a",
      itemDurationMs: 2500,
      itemId: "item-1",
      status: "succeeded",
    });
    expect(first).toMatchObject({
      batchRemaining: 2,
      batchTotal: 3,
      failed: 0,
      finished: 1,
      remainingTotal: 4,
      total: 5,
    });
    expect(first.elapsedMs).toBe(3000);
    expect(first.avgMsPerItem).toBe(3000);
    expect(first.etaMs).toBe(12_000);

    now = 7000;
    const second = tracker.record({
      batchId: "batch-a",
      itemDurationMs: 2000,
      itemId: "item-2",
      queueRemaining: 2,
      status: "failed",
    });
    expect(second).toMatchObject({
      batchRemaining: 1,
      failed: 1,
      finished: 1,
      remainingTotal: 2,
    });
  });
});
