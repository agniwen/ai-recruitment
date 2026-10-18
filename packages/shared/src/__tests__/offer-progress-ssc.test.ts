import { describe, expect, it } from "vitest";
import { describeResumeProgress } from "../studio-resumes";
import type { OfferProgress } from "../studio-resumes";

function progress(
  overrides: Partial<NonNullable<OfferProgress["latestDraft"]>> = {},
  totalVersions = 1,
) {
  return describeResumeProgress({
    outcome: "in_pipeline",
    pipelineStage: "offer",
    stageProgress: {
      aiInterview: null,
      humanInterview: null,
      offer: {
        latestDraft: {
          id: "current-offer",
          responseAt: null,
          sentAt: null,
          status: "draft",
          version: 1,
          ...overrides,
        },
        totalVersions,
      },
    },
  });
}

describe("candidate Offer execution progress", () => {
  it.each([
    ["pending", "Offer新增", "outline"],
    ["confirming", "确认中", "info"],
    ["completed", "已完成确认", "success"],
  ] as const)(
    "shows current SSC state %s for an internal draft",
    (sscConfirmationStatus, label, tone) => {
      expect(progress({ sscConfirmationStatus })).toEqual({ label: `Offer · ${label}`, tone });
    },
  );

  it("retains the current version in its execution label", () => {
    expect(progress({ sscConfirmationStatus: "confirming", version: 3 }, 2)).toEqual({
      label: "Offer v3 · 确认中",
      tone: "info",
    });
  });

  it.each([null, undefined])(
    "keeps legacy draft display when SSC state is %s",
    (sscConfirmationStatus) => {
      expect(progress({ sscConfirmationStatus })).toEqual({
        label: "Offer · 草稿",
        tone: "outline",
      });
    },
  );

  it.each([
    ["sent", "已发送 · 等响应", "info"],
    ["accepted", "已接受 · 待结案", "success"],
    ["declined", "已拒绝", "outline"],
    ["expired", "已过期", "outline"],
  ] as const)(
    "preserves the later execution state %s after SSC completion",
    (status, label, tone) => {
      expect(progress({ sscConfirmationStatus: "completed", status })).toEqual({
        label: `Offer · ${label}`,
        tone,
      });
    },
  );
});
