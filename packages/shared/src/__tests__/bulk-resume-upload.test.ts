import { describe, expect, it } from "vitest";
import {
  createBulkResumeBatchSchema,
  describeResumeRecruitmentSource,
} from "../bulk-resume-upload";

const baseInput = {
  dedupPolicy: "skip" as const,
  files: [
    {
      contentHash: "hash",
      fileSize: 1024,
      originalFileName: "resume.pdf",
      storageKey: "resumes/resume.pdf",
    },
  ],
  jdMode: "bind" as const,
  jobDescriptionId: "jd",
  recruitmentSource: "boss" as const,
  recruitmentSourceDetail: null,
  target: "resume_library" as const,
};

describe("createBulkResumeBatchSchema recruitment source", () => {
  it("accepts a predefined source without extra detail", () => {
    expect(createBulkResumeBatchSchema.safeParse(baseInput).success).toBe(true);
  });

  it("requires a source for resume-pool uploads", () => {
    const result = createBulkResumeBatchSchema.safeParse({
      ...baseInput,
      recruitmentSource: null,
      target: "resume_pool",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["recruitmentSource"]);
  });

  it.each(["referral", "other"] as const)("requires detail for %s", (recruitmentSource) => {
    const result = createBulkResumeBatchSchema.safeParse({
      ...baseInput,
      recruitmentSource,
      recruitmentSourceDetail: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["recruitmentSourceDetail"]);
  });
});

describe("describeResumeRecruitmentSource", () => {
  it("formats referral and custom source details for recommendation templates", () => {
    expect(describeResumeRecruitmentSource("referral", "李推荐")).toBe("内推（李推荐）");
    expect(describeResumeRecruitmentSource("other", "线下活动")).toBe("线下活动");
  });
});

describe("candidate upload destinations", () => {
  it.each(["auto", "none"])("rejects candidate mode %s", (jdMode) => {
    expect(
      createBulkResumeBatchSchema.safeParse({ ...baseInput, jdMode, jobDescriptionId: null })
        .success,
    ).toBe(false);
  });
  it("requires a concrete JD and rejects repeated organizations", () => {
    expect(
      createBulkResumeBatchSchema.safeParse({ ...baseInput, jobDescriptionId: null }).success,
    ).toBe(false);
    expect(
      createBulkResumeBatchSchema.safeParse({
        ...baseInput,
        destinations: [
          { hiringUnitId: "one", jobDescriptionId: "a" },
          { hiringUnitId: "one", jobDescriptionId: "b" },
        ],
      }).success,
    ).toBe(false);
  });
  it("accepts multiple concrete destinations and preserves unbound pool uploads", () => {
    expect(
      createBulkResumeBatchSchema.safeParse({
        ...baseInput,
        destinations: [
          { hiringUnitId: "one", jobDescriptionId: "a" },
          { hiringUnitId: "two", jobDescriptionId: "b" },
        ],
        jobDescriptionId: null,
      }).success,
    ).toBe(true);
    expect(
      createBulkResumeBatchSchema.safeParse({
        ...baseInput,
        jdMode: "none",
        jobDescriptionId: null,
        resumePoolScope: "private",
        target: "resume_pool",
      }).success,
    ).toBe(true);
  });
});
