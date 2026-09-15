import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBulkResumeBatchSchema } from "@arc/shared/bulk-resume-upload";
import { validateBatchDestinations } from "./validate-destinations";

const mocks = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock("../../job-descriptions/dao", () => ({ loadJobDescriptionById: vi.fn() }));
vi.mock("../../resume-pool/routes/import/options", () => ({
  loadResumePoolImportOptions: mocks.options,
}));

const jobs = [
  {
    departmentId: "operations",
    departmentName: "运营组",
    hiringUnitId: "tech",
    id: "REQ-001081",
    name: "中级运营",
    serviceUnit: "银河",
  },
  {
    departmentId: "tianshu",
    departmentName: "天枢",
    hiringUnitId: "tech",
    id: "REQ-000940",
    name: "中级运营",
    serviceUnit: "天枢",
  },
];
const request = () =>
  createBulkResumeBatchSchema.parse({
    dedupPolicy: "skip",
    destinations: jobs.map((job) => ({ hiringUnitId: job.hiringUnitId, jobDescriptionId: job.id })),
    files: [
      {
        contentHash: "hash",
        fileSize: 42,
        originalFileName: "resume.pdf",
        storageKey: "uploads/resume.pdf",
      },
    ],
    jdMode: "bind",
    recruitmentSource: "boss",
  });

beforeEach(() => {
  mocks.options.mockReset();
  mocks.options.mockResolvedValue({
    departments: [],
    hiringUnits: [{ id: "tech", name: "技术中心" }],
    jobDescriptions: jobs,
  });
});

describe("bulk upload destination validation", () => {
  it("accepts both jobs in one organization and derives each job's own department and service", async () => {
    expect(await validateBatchDestinations(request(), "workspace", "uploader")).toEqual(
      jobs.map((job) => ({
        departmentId: job.departmentId,
        departmentName: job.departmentName,
        hiringUnitId: job.hiringUnitId,
        jobDescriptionId: job.id,
        serviceUnit: job.serviceUnit,
      })),
    );
    expect(mocks.options).toHaveBeenCalledWith("workspace", "uploader");
  });
  it("rejects a job from outside the selected organization", async () => {
    mocks.options.mockResolvedValue({
      departments: [],
      hiringUnits: [{ id: "tech", name: "技术中心" }],
      jobDescriptions: [jobs[0], { ...jobs[1], hiringUnitId: "other" }],
    });
    await expect(validateBatchDestinations(request(), "workspace", "uploader")).rejects.toThrow(
      "所选岗位与入库组织不匹配",
    );
  });
  it("rejects a selection after a job is removed from the user's accessible options", async () => {
    mocks.options.mockResolvedValue({
      departments: [],
      hiringUnits: [{ id: "tech", name: "技术中心" }],
      jobDescriptions: [jobs[0]],
    });
    await expect(validateBatchDestinations(request(), "workspace", "uploader")).rejects.toThrow(
      "所选岗位与入库组织不匹配",
    );
  });
  it("still rejects different job names in one batch", async () => {
    mocks.options.mockResolvedValue({
      departments: [],
      hiringUnits: [{ id: "tech", name: "技术中心" }],
      jobDescriptions: [jobs[0], { ...jobs[1], name: "高级运营" }],
    });
    await expect(validateBatchDestinations(request(), "workspace", "uploader")).rejects.toThrow(
      "同一岗位名称",
    );
  });
});
