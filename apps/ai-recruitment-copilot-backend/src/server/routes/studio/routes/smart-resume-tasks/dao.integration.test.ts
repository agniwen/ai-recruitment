import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  chatAttachment,
  department,
  hiringUnit,
  jobDescription,
  jobMatchingProfile,
  member,
  organization,
  recruitingGroup,
  recruitingGroupMember,
  recruitingGroupResumeSource,
  resumePoolItem,
  resumeSemanticIndex,
  resumeSource,
  resumeUploadBatch,
  resumeUploadBatchItem,
  smartResumeTaskItem,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import { resumeProfileSchema } from "@arc/db-schema/interview/types";
import type {
  PortfolioAttachment,
  PortfolioItem,
  ResumeRecruitmentSource,
} from "@arc/shared/bulk-resume-upload";
import { insertBatchWithItems, reviveOrphans } from "../resume-upload-batches/dao/batches";
import { processBatchItem } from "../resume-upload-batches/utils/processor";
import {
  listUnsubmittedSmartTasks,
  loadSmartTask,
  retrySmartTask,
  saveSmartTaskDraft,
  submitSmartTask,
} from "./dao";
import { loadEligibleSmartJobs } from "./utils/jobs";
import { recommendSmartJobs } from "./utils/recommend";
import { matchingProfileSourceHash } from "../job-descriptions/utils/matching-profile";
import { loadOwnedTaskItemFile } from "./routes/items/dao";
import {
  loadJobMatchingIndexRows,
  markJobMatchingIndexesPending,
} from "../job-descriptions/routes/matching-index/dao";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), parse: vi.fn(), rerank: vi.fn() }));
vi.mock("./utils/rerank", () => ({ rerankJobDocuments: mocks.rerank }));
vi.mock("@arc/resume-parse-queue/resume-parse", () => ({ enqueueResumeParseJobs: mocks.enqueue }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-semantic/enqueue", () => ({
  enqueueResumeSemanticIndexJobBestEffort: vi.fn().mockResolvedValue(true),
}));
vi.mock("../resumes/utils/review-queue", () => ({
  enqueueResumePoolReviewGenerationBestEffort: vi.fn().mockResolvedValue(true),
  enqueueResumeReviewGenerationForRecordBestEffort: vi.fn().mockResolvedValue(true),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/resume-analysis-agent", () => ({
  parseResumeBytesToProfile: mocks.parse,
}));

const prefix = `smart-test-${randomUUID()}`;
const org = `${prefix}-org`;
const uploader = `${prefix}-user`;
const outsider = `${prefix}-outsider`;
const sourceA = `${prefix}-a`;
const sourceB = `${prefix}-b`;
const unit = `${prefix}-unit`;
const dept = `${prefix}-dept`;
const jobA = `${prefix}-job-a`;
const jobB = `${prefix}-job-b`;
const group = `${prefix}-group`;
const profile = resumeProfileSchema.parse({
  age: null,
  educationExperiences: [],
  email: null,
  gender: null,
  name: "测试候选人",
  personalStrengths: [],
  phone: null,
  projectExperiences: [],
  schools: [],
  skills: ["React"],
  targetRoles: [],
  workExperiences: [
    {
      company: "测试公司",
      period: "2022-2026",
      role: "前端开发",
      summary: "使用 React 开发管理系统",
    },
  ],
  workYears: 4,
});

async function newTask(
  parsed = true,
  recruitmentSource: ResumeRecruitmentSource | null = "boss",
  portfolioAttachments: PortfolioItem[] = [],
) {
  const id = await insertBatchWithItems({
    dedupPolicy: "create",
    files: [
      {
        contentHash: `${prefix}-${randomUUID()}`,
        fileSize: 100,
        originalFileName: "test.pdf",
        portfolioAttachments,
        storageKey: `${prefix}/${randomUUID()}.pdf`,
      },
    ],
    jdMode: "none",
    jobDescriptionId: null,
    organizationId: org,
    recruitmentSource,
    resumePoolScope: "private",
    smartUpload: true,
    target: "resume_pool",
    userId: uploader,
  });
  const [item] = await db
    .select()
    .from(resumeUploadBatchItem)
    .where(eq(resumeUploadBatchItem.batchId, id));
  if (!item?.poolItemId) {
    throw new Error("Missing task fixture item");
  }
  if (parsed) {
    await db
      .update(resumePoolItem)
      .set({
        candidateName: profile.name,
        resumeParseStatus: "ready",
        resumeParsedAt: new Date(),
        resumeProfile: profile,
      })
      .where(eq(resumePoolItem.id, item.poolItemId));
  }
  return { id, item };
}

async function readyTask() {
  const task = await newTask();
  await db
    .update(resumeUploadBatchItem)
    .set({ status: "succeeded" })
    .where(eq(resumeUploadBatchItem.id, task.item.id));
  await db
    .update(smartResumeTaskItem)
    .set({ selectedJobIds: [jobA], status: "ready" })
    .where(eq(smartResumeTaskItem.id, task.item.id));
  return task;
}

async function newPortfolio(ownerId = uploader): Promise<PortfolioAttachment> {
  const id = randomUUID();
  const attachment = { id, mimeType: "application/pdf", name: "作品.pdf", size: 100 };
  await db.insert(chatAttachment).values({
    filename: attachment.name,
    id,
    mediaType: attachment.mimeType,
    organizationId: org,
    size: attachment.size,
    storageKey: `${prefix}/portfolio/${id}.pdf`,
    userId: ownerId,
  });
  return attachment;
}

describe.skipIf(process.env.SMART_UPLOAD_DB_TESTS !== "1")(
  "smart upload persistence and scope (local PostgreSQL)",
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        throw new Error("Smart-upload integration tests require a local database");
      }
      await db.insert(user).values([
        { email: `${uploader}@example.com`, id: uploader, name: "Smart test" },
        { email: `${outsider}@example.com`, id: outsider, name: "Other test" },
      ]);
      await db.insert(organization).values({ id: org, name: "Smart test", slug: org });
      await db
        .insert(member)
        .values({ id: `${prefix}-member`, organizationId: org, role: "member", userId: uploader });
      await db.insert(resumeSource).values([
        { id: sourceA, name: "中心 A", organizationId: org },
        { id: sourceB, name: "中心 B", organizationId: org },
      ]);
      await db
        .insert(hiringUnit)
        .values({ id: unit, name: "用人组织", organizationId: org, resumeSourceId: sourceA });
      await db
        .insert(department)
        .values({ hiringUnitId: unit, id: dept, name: "共享部门", organizationId: org });
      await db.insert(recruitingGroup).values({ id: group, name: "招聘组", organizationId: org });
      await db.insert(recruitingGroupMember).values({
        groupId: group,
        id: `${prefix}-gm`,
        organizationId: org,
        role: "hr",
        userId: uploader,
      });
      await db.insert(recruitingGroupResumeSource).values({
        groupId: group,
        id: `${prefix}-gs`,
        organizationId: org,
        resumeSourceId: sourceA,
      });
      await db.insert(jobDescription).values([
        {
          departmentId: dept,
          hiringUnitId: unit,
          id: jobA,
          name: "前端工程师",
          organizationId: org,
          prompt: "负责 React 管理系统",
          resumeSourceId: sourceA,
        },
        {
          departmentId: dept,
          hiringUnitId: unit,
          id: jobB,
          name: "无权岗位",
          organizationId: org,
          prompt: "FORBIDDEN_JOB_CONTENT",
          resumeSourceId: sourceB,
        },
      ]);
      await db.insert(jobMatchingProfile).values(
        [jobA, jobB].map((jobDescriptionId) => ({
          confirmedAt: new Date(),
          jobDescriptionId,
          profile: {
            domains: [],
            minimumEducation: null,
            minimumWorkYears: null,
            preferredSkills: [],
            requiredSkills: ["React"],
            responsibilities: [],
            roleFamily: "前端开发",
            seniority: "",
          },
          sourceHash: matchingProfileSourceHash({
            description: null,
            name: jobDescriptionId === jobA ? "前端工程师" : "无权岗位",
            prompt: jobDescriptionId === jobA ? "负责 React 管理系统" : "FORBIDDEN_JOB_CONTENT",
          }),
        })),
      );
    });
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.rerank.mockResolvedValue({
        model: "qwen3-rerank",
        results: [{ index: 0, relevance_score: 0.9 }],
        tokens: 100,
      });
      mocks.enqueue.mockResolvedValue([]);
    });
    afterAll(async () => {
      await db.delete(resumeUploadBatch).where(eq(resumeUploadBatch.organizationId, org));
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, org));
      await db.delete(resumePoolItem).where(eq(resumePoolItem.organizationId, org));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, org));
      await db.delete(department).where(eq(department.organizationId, org));
      await db.delete(hiringUnit).where(eq(hiringUnit.organizationId, org));
      await db.delete(organization).where(eq(organization.id, org));
      await db.delete(user).where(eq(user.id, uploader));
      await db.delete(user).where(eq(user.id, outsider));
    });

    it("restricts JD text and reranking to direct job source scope, including shared departments", async () => {
      const eligible = await loadEligibleSmartJobs(org, uploader);
      expect(eligible.map((entry) => entry.job.id)).toEqual([jobA]);
      const result = await recommendSmartJobs(profile, org, uploader);
      expect(result.recommendations.map((entry) => entry.jobDescriptionId)).toEqual([jobA]);
      expect(mocks.rerank.mock.calls[0]?.[1]).toHaveLength(1);
      expect(JSON.stringify(mocks.rerank.mock.calls)).not.toContain("FORBIDDEN_JOB_CONTENT");
      expect(await loadEligibleSmartJobs(org, outsider)).toEqual([]);
    });
    it("initializes only the workspace's selectable jobs and resets copied index markers for rebuilding", async () => {
      const rows = await loadJobMatchingIndexRows(org, "maintenance-test-v1");
      expect(rows.map((row) => row.job.id).toSorted()).toEqual([jobA, jobB].toSorted());
      const config = { embeddingVersion: "maintenance-test-v1", model: "embedding-test" };
      await markJobMatchingIndexesPending(org, rows, config);
      await db
        .update(resumeSemanticIndex)
        .set({ status: "indexed" })
        .where(
          and(
            eq(resumeSemanticIndex.organizationId, org),
            eq(resumeSemanticIndex.embeddingVersion, config.embeddingVersion),
          ),
        );
      await markJobMatchingIndexesPending(org, rows, config);
      const rebuilt = await loadJobMatchingIndexRows(org, config.embeddingVersion);
      expect(rebuilt.every((row) => row.indexStatus === "pending")).toBe(true);
      expect(rebuilt.every((row) => row.profile?.requiredSkills.includes("React"))).toBe(true);
      await db
        .update(jobDescription)
        .set({ manuallyInactive: true })
        .where(eq(jobDescription.id, jobA));
      try {
        const selectable = await loadJobMatchingIndexRows(org, config.embeddingVersion);
        expect(selectable.map((row) => row.job.id)).toEqual([jobB]);
      } finally {
        await db
          .update(jobDescription)
          .set({ manuallyInactive: false })
          .where(eq(jobDescription.id, jobA));
      }
    });
    it("saves selections across reads, rejects other users and foreign task items", async () => {
      const first = await readyTask();
      const second = await readyTask();
      await saveSmartTaskDraft(first.id, org, uploader, {
        items: [{ itemId: first.item.id, jobDescriptionIds: [], skipped: true }],
      });
      const saved = await loadSmartTask(first.id, org, uploader);
      expect(saved?.items[0]?.skipped).toBe(true);
      expect(await loadSmartTask(first.id, org, outsider)).toBeNull();
      await expect(
        saveSmartTaskDraft(first.id, org, uploader, {
          items: [{ itemId: second.item.id, jobDescriptionIds: [jobA], skipped: false }],
        }),
      ).rejects.toThrow("文件列表");
      await expect(
        saveSmartTaskDraft(first.id, org, outsider, { recruitmentSource: "liepin" }),
      ).rejects.toThrow("无权访问");
    });
    it("analyzes without a source and admits using the source completed in the task", async () => {
      const task = await newTask(true, null);
      await processBatchItem(task.item.id);
      const analyzed = await loadSmartTask(task.id, org, uploader);
      expect(analyzed?.recruitmentSource).toBeNull();
      expect(analyzed?.items[0]?.status).toBe("ready");
      expect(mocks.parse).not.toHaveBeenCalled();
      await expect(submitSmartTask(task.id, org, uploader)).rejects.toThrow("补全来源");
      await saveSmartTaskDraft(task.id, org, uploader, {
        recruitmentSource: "referral",
        recruitmentSourceDetail: null,
      });
      const incomplete = await loadSmartTask(task.id, org, uploader);
      expect(incomplete?.recruitmentSource).toBe("referral");
      await expect(submitSmartTask(task.id, org, uploader)).rejects.toThrow("补全来源");
      await saveSmartTaskDraft(task.id, org, uploader, { recruitmentSourceDetail: "  推荐人甲  " });
      const saved = await loadSmartTask(task.id, org, uploader);
      expect(saved?.recruitmentSourceDetail).toBe("推荐人甲");
      const [pool] = await db
        .select()
        .from(resumePoolItem)
        .where(eq(resumePoolItem.id, task.item.poolItemId ?? ""));
      expect(pool?.recruitmentSourceDetail).toBe("推荐人甲");
      expect(pool?.sourceChannel).toBe("referral");
      // Admission must read the task's current source, even if pool metadata is stale.
      await db
        .update(resumePoolItem)
        .set({ recruitmentSource: null, recruitmentSourceDetail: null })
        .where(eq(resumePoolItem.id, task.item.poolItemId ?? ""));
      const submitted = await submitSmartTask(task.id, org, uploader);
      const [record] = await db
        .select()
        .from(studioInterview)
        .where(eq(studioInterview.id, submitted.recordIds[0] ?? ""));
      expect(record?.recruitmentSource).toBe("referral");
      expect(record?.recruitmentSourceDetail).toBe("推荐人甲");
      await expect(
        saveSmartTaskDraft(task.id, org, uploader, { recruitmentSource: "boss" }),
      ).rejects.toThrow("已经提交");
    });
    it("clears old source details and saves source and destination changes atomically", async () => {
      const task = await readyTask();
      await saveSmartTaskDraft(task.id, org, uploader, {
        recruitmentSource: "referral",
        recruitmentSourceDetail: "推荐人甲",
      });
      await saveSmartTaskDraft(task.id, org, uploader, { recruitmentSource: "other" });
      const changed = await loadSmartTask(task.id, org, uploader);
      expect(changed?.recruitmentSourceDetail).toBeNull();
      await saveSmartTaskDraft(task.id, org, uploader, { recruitmentSourceDetail: "招聘会" });
      await saveSmartTaskDraft(task.id, org, uploader, { recruitmentSourceDetail: null });
      await expect(submitSmartTask(task.id, org, uploader)).rejects.toThrow("补全来源");
      await expect(
        saveSmartTaskDraft(task.id, org, uploader, {
          items: [{ itemId: task.item.id, jobDescriptionIds: [jobB], skipped: false }],
          recruitmentSource: "boss",
        }),
      ).rejects.toThrow("无权访问");
      const retained = await loadSmartTask(task.id, org, uploader);
      expect(retained?.recruitmentSource).toBe("other");
      await saveSmartTaskDraft(task.id, org, uploader, { recruitmentSource: "boss" });
      const saved = await loadSmartTask(task.id, org, uploader);
      expect(saved?.recruitmentSourceDetail).toBeNull();
    });
    it("rechecks current job availability and rolls back admission when a selected job closes", async () => {
      const task = await readyTask();
      await db
        .update(jobDescription)
        .set({ manuallyInactive: true })
        .where(eq(jobDescription.id, jobA));
      try {
        await expect(submitSmartTask(task.id, org, uploader)).rejects.toThrow("已失效");
        const retained = await loadSmartTask(task.id, org, uploader);
        expect(retained?.submittedAt).toBeNull();
      } finally {
        await db
          .update(jobDescription)
          .set({ manuallyInactive: false })
          .where(eq(jobDescription.id, jobA));
      }
    });
    it("serializes concurrent submit and excludes submitted tasks from the server list", async () => {
      const task = await readyTask();
      const before = await listUnsubmittedSmartTasks(org, uploader);
      expect(before.some((entry) => entry.id === task.id)).toBe(true);
      const [first, second] = await Promise.all([
        submitSmartTask(task.id, org, uploader),
        submitSmartTask(task.id, org, uploader),
      ]);
      expect(first.recordIds).toHaveLength(1);
      expect(first.recordIds).toEqual(second.recordIds);
      const after = await listUnsubmittedSmartTasks(org, uploader);
      expect(after.some((entry) => entry.id === task.id)).toBe(false);
      const submitted = await loadSmartTask(task.id, org, uploader);
      expect(submitted?.items[0]?.selectedJobIds).toEqual([jobA]);
    });
    it("persists portfolio-only edits without touching selections and carries them into each destination", async () => {
      const task = await readyTask();
      const file = await newPortfolio();
      const link = {
        id: randomUUID(),
        kind: "link" as const,
        name: "个人网站",
        url: "https://example.com/portfolio",
      };
      const attachments = [file, link];
      await db
        .update(smartResumeTaskItem)
        .set({ selectionTouched: false })
        .where(eq(smartResumeTaskItem.id, task.item.id));
      await saveSmartTaskDraft(task.id, org, uploader, {
        items: [{ itemId: task.item.id, portfolioAttachments: attachments }],
      });
      const saved = await loadSmartTask(task.id, org, uploader);
      expect(saved?.items[0]?.portfolioAttachments).toEqual(attachments);
      expect(saved?.items[0]?.selectedJobIds).toEqual([jobA]);
      const [stored] = await db
        .select()
        .from(smartResumeTaskItem)
        .where(eq(smartResumeTaskItem.id, task.item.id));
      expect(stored.selectionTouched).toBe(false);
      const secondJob = `${prefix}-portfolio-job`;
      await db.insert(jobDescription).values({
        departmentId: dept,
        hiringUnitId: unit,
        id: secondJob,
        name: "第二岗位",
        organizationId: org,
        prompt: "前端开发",
        resumeSourceId: sourceA,
      });
      try {
        await saveSmartTaskDraft(task.id, org, uploader, {
          items: [{ itemId: task.item.id, jobDescriptionIds: [jobA, secondJob], skipped: false }],
        });
        const submitted = await submitSmartTask(task.id, org, uploader);
        expect(submitted.recordIds).toHaveLength(2);
        const records = await db
          .select({ attachments: studioInterview.portfolioAttachments })
          .from(studioInterview)
          .where(inArray(studioInterview.id, submitted.recordIds));
        expect(records.map((record) => record.attachments)).toEqual([attachments, attachments]);
        await expect(
          saveSmartTaskDraft(task.id, org, uploader, {
            items: [{ itemId: task.item.id, portfolioAttachments: [] }],
          }),
        ).rejects.toThrow("已经提交");
      } finally {
        await db.delete(jobDescription).where(eq(jobDescription.id, secondJob));
      }
    });
    it("stages initial portfolios and rejects foreign files, tampered metadata, and foreign task items", async () => {
      const file = await newPortfolio();
      const task = await newTask(true, "boss", [file]);
      const staged = await loadSmartTask(task.id, org, uploader);
      expect(staged?.items[0]?.portfolioAttachments).toEqual([file]);
      const foreign = await newPortfolio(outsider);
      await expect(
        saveSmartTaskDraft(task.id, org, uploader, {
          items: [{ itemId: task.item.id, portfolioAttachments: [foreign] }],
        }),
      ).rejects.toThrow("无权访问");
      await expect(
        saveSmartTaskDraft(task.id, org, uploader, {
          items: [{ itemId: task.item.id, portfolioAttachments: [{ ...file, size: 999 }] }],
        }),
      ).rejects.toThrow("无权访问");
      const otherTask = await readyTask();
      await expect(
        saveSmartTaskDraft(task.id, org, uploader, {
          items: [{ itemId: otherTask.item.id, portfolioAttachments: [file] }],
        }),
      ).rejects.toThrow("文件列表");
      await expect(
        saveSmartTaskDraft(task.id, org, outsider, {
          items: [{ itemId: task.item.id, portfolioAttachments: [] }],
        }),
      ).rejects.toThrow("无权访问");
    });
    it("only resolves resume and portfolio files belonging to the uploader and requested task item", async () => {
      const file = await newPortfolio();
      const task = await newTask(true, "boss", [file]);
      const otherTask = await readyTask();
      const otherFile = await newPortfolio();
      expect(await loadOwnedTaskItemFile(task.id, task.item.id, org, uploader)).toMatchObject({
        filename: "test.pdf",
        storageKey: task.item.storageKey,
      });
      expect(
        await loadOwnedTaskItemFile(task.id, task.item.id, org, uploader, file.id),
      ).toMatchObject({ filename: file.name, mediaType: file.mimeType });
      expect(await loadOwnedTaskItemFile(task.id, task.item.id, org, outsider)).toBeNull();
      expect(await loadOwnedTaskItemFile(task.id, task.item.id, org, outsider, file.id)).toBeNull();
      expect(await loadOwnedTaskItemFile(task.id, otherTask.item.id, org, uploader)).toBeNull();
      expect(
        await loadOwnedTaskItemFile(task.id, task.item.id, org, uploader, otherFile.id),
      ).toBeNull();
      expect(
        await loadOwnedTaskItemFile(task.id, task.item.id, `${org}-foreign`, uploader),
      ).toBeNull();
    });
    it("rejects admission after the uploader loses responsibility for the center", async () => {
      const task = await readyTask();
      await db
        .delete(recruitingGroupResumeSource)
        .where(eq(recruitingGroupResumeSource.id, `${prefix}-gs`));
      try {
        await expect(submitSmartTask(task.id, org, uploader)).rejects.toThrow("已超出负责范围");
      } finally {
        await db.insert(recruitingGroupResumeSource).values({
          groupId: group,
          id: `${prefix}-gs`,
          organizationId: org,
          resumeSourceId: sourceA,
        });
      }
    });
    it("keeps failed parsing retryable and permits explicitly skipping failed files", async () => {
      const task = await newTask(false, null);
      await db
        .update(resumeUploadBatchItem)
        .set({ errorMessage: "fixture parse failure", status: "failed" })
        .where(eq(resumeUploadBatchItem.id, task.item.id));
      await saveSmartTaskDraft(task.id, org, uploader, {
        items: [{ itemId: task.item.id, jobDescriptionIds: [], skipped: true }],
      });
      expect(await submitSmartTask(task.id, org, uploader)).toEqual({ recordIds: [] });
    });
    it("recovers an interrupted task and reuses its parsed resume without OCR or parsing", async () => {
      const task = await newTask();
      await db
        .update(resumeUploadBatchItem)
        .set({ startedAt: new Date(0), status: "processing" })
        .where(eq(resumeUploadBatchItem.id, task.item.id));
      await db
        .update(smartResumeTaskItem)
        .set({ status: "processing" })
        .where(eq(smartResumeTaskItem.id, task.item.id));
      await reviveOrphans(task.id, org, uploader, 1);
      await processBatchItem(task.item.id);
      expect(mocks.parse).not.toHaveBeenCalled();
      const restored = await loadSmartTask(task.id, org, uploader);
      expect(restored?.items[0]?.status).toBe("ready");
      expect(restored?.items[0]?.result?.recommendations[0]?.jobDescriptionId).toBe(jobA);
      expect(restored?.items[0]?.selectedJobIds).toEqual([jobA]);
      const [pool] = await db
        .select()
        .from(resumePoolItem)
        .where(eq(resumePoolItem.id, task.item.poolItemId ?? ""));
      expect(pool?.resumeProfile).toEqual(profile);
    });
    it("continues a parsed task whose recommendation has not started", async () => {
      const task = await newTask();
      await db
        .update(resumeUploadBatchItem)
        .set({ status: "succeeded" })
        .where(eq(resumeUploadBatchItem.id, task.item.id));
      await db
        .update(resumeUploadBatch)
        .set({ status: "completed" })
        .where(eq(resumeUploadBatch.id, task.id));
      expect(await retrySmartTask(task.id, org, uploader)).toEqual({ queued: 1 });
      await processBatchItem(task.item.id);
      const resumed = await loadSmartTask(task.id, org, uploader);
      expect(resumed?.items[0]?.status).toBe("ready");
      expect(mocks.parse).not.toHaveBeenCalled();
    });
    it("stores reranker failure separately and retries without changing parsed facts", async () => {
      const task = await newTask();
      mocks.rerank.mockRejectedValueOnce(new Error("fixture provider outage"));
      await processBatchItem(task.item.id);
      const failed = await loadSmartTask(task.id, org, uploader);
      expect(failed?.items[0]?.status).toBe("failed");
      await retrySmartTask(task.id, org, uploader);
      expect(mocks.enqueue).toHaveBeenCalledOnce();
      await processBatchItem(task.item.id);
      const retried = await loadSmartTask(task.id, org, uploader);
      expect(retried?.items[0]?.status).toBe("ready");
      expect(mocks.parse).not.toHaveBeenCalled();
      const stored = await db
        .select()
        .from(resumeUploadBatchItem)
        .where(
          and(
            eq(resumeUploadBatchItem.batchId, task.id),
            eq(resumeUploadBatchItem.id, task.item.id),
          ),
        );
      expect(stored[0]?.status).toBe("succeeded");
    });
  },
);
