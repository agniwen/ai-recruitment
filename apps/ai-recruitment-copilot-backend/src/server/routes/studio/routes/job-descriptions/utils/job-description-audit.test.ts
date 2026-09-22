import { describe, expect, it, vi } from "vitest";
import {
  adjustJobDescriptionOnboardedCount,
  buildJobDescriptionAuditChanges,
  resolveJobDescriptionStaffing,
} from "./job-description-audit";

describe("resolveJobDescriptionStaffing", () => {
  it("derives the remaining gap from HC and onboarded count", () => {
    expect(resolveJobDescriptionStaffing({ headcount: 5, onboardedCount: 2 })).toEqual({
      gapCount: 3,
      headcountBelowOnboarded: false,
      onboardedCount: 2,
    });
  });

  it("keeps an over-hired fact, floors the gap at zero, and reports the anomaly", () => {
    expect(resolveJobDescriptionStaffing({ headcount: 1, onboardedCount: 2 })).toEqual({
      gapCount: 0,
      headcountBelowOnboarded: true,
      onboardedCount: 2,
    });
  });

  it("treats an empty onboarded count as zero and preserves an unknown HC", () => {
    expect(resolveJobDescriptionStaffing({ headcount: null, onboardedCount: null })).toEqual({
      gapCount: null,
      headcountBelowOnboarded: false,
      onboardedCount: 0,
    });
  });
});

describe("buildJobDescriptionAuditChanges", () => {
  it("records only changed fields with JSON-safe values", () => {
    expect(
      buildJobDescriptionAuditChanges(
        { headcount: 3, name: "后端", updatedAt: new Date("2026-09-22T00:00:00Z") },
        { headcount: 4, name: "后端", updatedAt: new Date("2026-09-22T01:00:00Z") },
      ),
    ).toEqual({
      headcount: { after: 4, before: 3 },
      updatedAt: {
        after: "2026-09-22T01:00:00.000Z",
        before: "2026-09-22T00:00:00.000Z",
      },
    });
  });
});

describe("adjustJobDescriptionOnboardedCount", () => {
  it.each([
    {
      delta: 1 as const,
      expectedGap: 0,
      expectedOnboarded: 3,
      expectedSource: "candidate_hired",
      headcount: 2,
      onboardedCount: 2,
      overCapacity: true,
    },
    {
      delta: -1 as const,
      expectedGap: 2,
      expectedOnboarded: 1,
      expectedSource: "candidate_reactivated",
      headcount: 3,
      onboardedCount: 2,
      overCapacity: false,
    },
  ])(
    "applies a $delta onboarding delta and records $expectedSource",
    async ({
      delta,
      expectedGap,
      expectedOnboarded,
      expectedSource,
      headcount,
      onboardedCount,
      overCapacity,
    }) => {
      const updated = vi.fn(async () => {});
      const inserted = vi.fn(async () => {});
      const tx = {
        insert: vi.fn(() => ({ values: inserted })),
        select: vi.fn(() => ({
          for: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            {
              code: "JOB-1",
              gapCount: Math.max(headcount - onboardedCount, 0),
              headcount,
              id: "job-1",
              name: "后端工程师",
              onboardedCount,
            },
          ]),
          where: vi.fn().mockReturnThis(),
        })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: updated })) })),
      };

      await adjustJobDescriptionOnboardedCount(tx as never, {
        candidateId: "candidate-1",
        delta,
        jobDescriptionId: "job-1",
        now: new Date("2026-09-22T08:00:00Z"),
        operatorId: "user-1",
        operatorRole: "odc",
        organizationId: "org-1",
      });

      expect(tx.update.mock.results[0]?.value.set).toHaveBeenCalledWith({
        gapCount: expectedGap,
        onboardedCount: expectedOnboarded,
        updatedAt: new Date("2026-09-22T08:00:00Z"),
      });
      expect(inserted).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "staffing_counts_updated",
          candidateId: "candidate-1",
          detail: expect.objectContaining({
            changes: {
              ...(expectedGap === Math.max(headcount - onboardedCount, 0)
                ? {}
                : {
                    gapCount: {
                      after: expectedGap,
                      before: Math.max(headcount - onboardedCount, 0),
                    },
                  }),
              onboardedCount: { after: expectedOnboarded, before: onboardedCount },
            },
            headcountBelowOnboarded: overCapacity,
          }),
          source: expectedSource,
        }),
      );
    },
  );
});
