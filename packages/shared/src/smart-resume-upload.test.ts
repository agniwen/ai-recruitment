import { describe, expect, it } from "vitest";
import {
  createSmartResumeTaskSchema,
  isSmartResumeTaskSourceComplete,
  smartResumeSelectionSchema,
  smartResumeTaskDraftSchema,
} from "./smart-resume-upload";

const input = {
  files: [
    {
      contentHash: "hash",
      fileSize: 100,
      originalFileName: "test.pdf",
      storageKey: "resumes/test.pdf",
    },
  ],
  requestId: "15ce7c54-712b-49d0-91db-f9cd25a30240",
};

describe("smart upload input", () => {
  it("accepts uploads without a source so analysis can start immediately", () => {
    expect(createSmartResumeTaskSchema.safeParse(input).success).toBe(true);
    expect(
      createSmartResumeTaskSchema.safeParse({ ...input, recruitmentSource: null }).success,
    ).toBe(true);
    expect(
      createSmartResumeTaskSchema.safeParse({ ...input, recruitmentSource: "referral" }).success,
    ).toBe(true);
    expect(
      createSmartResumeTaskSchema.safeParse({
        ...input,
        recruitmentSource: "referral",
        recruitmentSourceDetail: "推荐人",
      }).success,
    ).toBe(true);
  });
  it("allows incomplete source drafts but validates completeness before admission", () => {
    expect(smartResumeTaskDraftSchema.safeParse({}).success).toBe(false);
    expect(smartResumeTaskDraftSchema.safeParse({ recruitmentSource: "referral" }).success).toBe(
      true,
    );
    expect(smartResumeTaskDraftSchema.safeParse({ recruitmentSource: "invalid" }).success).toBe(
      false,
    );
    expect(
      smartResumeTaskDraftSchema.safeParse({ recruitmentSourceDetail: "a".repeat(501) }).success,
    ).toBe(false);
    expect(
      isSmartResumeTaskSourceComplete({ recruitmentSource: null, recruitmentSourceDetail: null }),
    ).toBe(false);
    expect(
      isSmartResumeTaskSourceComplete({ recruitmentSource: "boss", recruitmentSourceDetail: null }),
    ).toBe(true);
    for (const recruitmentSource of ["referral", "other"] as const) {
      expect(
        isSmartResumeTaskSourceComplete({ recruitmentSource, recruitmentSourceDetail: " " }),
      ).toBe(false);
      expect(
        isSmartResumeTaskSourceComplete({ recruitmentSource, recruitmentSourceDetail: "来源信息" }),
      ).toBe(true);
    }
  });
  it("rejects duplicate files and duplicate destinations", () => {
    expect(
      createSmartResumeTaskSchema.safeParse({ ...input, files: [input.files[0], input.files[0]] })
        .success,
    ).toBe(false);
    expect(
      smartResumeSelectionSchema.safeParse({
        items: [{ itemId: input.requestId, jobDescriptionIds: ["job", "job"], skipped: false }],
      }).success,
    ).toBe(false);
  });
  it("accepts portfolio-only drafts and validates links and the combined attachment limit", () => {
    const link = {
      id: input.requestId,
      kind: "link",
      name: "作品集",
      url: "https://example.com/portfolio",
    };
    const draft = (portfolioAttachments: unknown[]) => ({
      items: [{ itemId: input.requestId, portfolioAttachments }],
    });
    expect(smartResumeTaskDraftSchema.safeParse(draft([link])).success).toBe(true);
    expect(smartResumeTaskDraftSchema.safeParse(draft([])).success).toBe(true);
    expect(
      smartResumeTaskDraftSchema.safeParse(draft(Array.from({ length: 11 }, () => link))).success,
    ).toBe(false);
    expect(
      smartResumeTaskDraftSchema.safeParse(draft([{ ...link, url: "ftp://example.com/file" }]))
        .success,
    ).toBe(false);
    expect(
      smartResumeTaskDraftSchema.safeParse({ items: [{ itemId: input.requestId }] }).success,
    ).toBe(false);
  });
});
