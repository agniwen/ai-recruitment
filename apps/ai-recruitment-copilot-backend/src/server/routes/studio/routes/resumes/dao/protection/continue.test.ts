import { beforeEach, describe, expect, it, vi } from "vitest";
import { studioInterview } from "@arc/db-schema/schema";
import { continueProtectedResume } from "./continue";

const state = vi.hoisted(() => ({
  admit: vi.fn(),
  audits: [] as Record<string, unknown>[],
  conflict: vi.fn(),
  row: null as Record<string, unknown> | null,
}));

vi.mock("./index", () => ({
  admitResumeRecord: state.admit,
  findResumeProtectionConflict: state.conflict,
  identityForResume: () => ({ contentHash: "hash" }),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => {
  const tx = {
    execute: vi.fn(),
    insert: () => ({ values: (value: Record<string, unknown>) => state.audits.push(value) }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === studioInterview) {
              return Promise.resolve(state.row ? [state.row] : []);
            }
            return Promise.resolve(state.audits);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          Object.assign(state.row ?? {}, patch);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: { transaction: (run: (executor: typeof tx) => Promise<unknown>) => run(tx) } };
});

const input = {
  jobDescriptionId: "job-b",
  memberRole: "member",
  organizationId: "workspace",
  recordId: "blocked",
  userId: "uploader",
};
const protection = {
  cycleId: "original-cycle",
  durationDays: 15,
  expiresAt: "2026-11-06T06:00:00Z",
  ownerUserId: "original-owner",
};

beforeEach(() => {
  vi.clearAllMocks();
  state.audits = [];
  state.row = {
    createdBy: "uploader",
    id: "blocked",
    jobDescriptionId: "job-b",
    outcome: "in_pipeline",
    pipelineStage: "ai_review",
    resumeAdmissionStatus: "protected",
    resumeParseStatus: "ready",
    resumeProfile: { name: "沈炼" },
    resumeProtection: protection,
    resumeReviewStatus: "idle",
  };
  state.conflict.mockResolvedValue(protection);
  state.admit.mockImplementation(() => {
    Object.assign(state.row ?? {}, {
      resumeAdmissionStatus: "accepted",
      resumeProtectionCycleId: "new-cycle",
    });
    return Promise.resolve("accepted");
  });
});

describe("continue a protected recommendation", () => {
  it("admits only this upload, retains the original protection, and records confirmation", async () => {
    const result = await continueProtectedResume(input);
    expect(result).toMatchObject({ jobDescriptionId: "job-b", needsAnalysis: true });
    expect(state.row).toMatchObject({
      createdBy: "uploader",
      pipelineStage: "ai_review",
      resumeAdmissionStatus: "accepted",
      resumeProtectionCycleId: "original-cycle",
    });
    expect(state.admit).not.toHaveBeenCalled();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "resume_protection_continued",
      detail: { protectionOwnerUserId: "original-owner" },
      operatorId: "uploader",
    });
    expect(protection.expiresAt).toBe("2026-11-06T06:00:00Z");
  });

  it("rechecks current protection and uses normal admission after expiry", async () => {
    state.conflict.mockResolvedValue(null);
    await continueProtectedResume(input);
    expect(state.admit).toHaveBeenCalled();
    expect(state.row?.resumeProtectionCycleId).toBe("new-cycle");
  });

  it("allows an idempotent retry without another confirmation audit", async () => {
    await continueProtectedResume(input);
    if (state.row) {
      state.row.resumeReviewStatus = "queued";
    }
    expect(await continueProtectedResume(input)).toMatchObject({ needsAnalysis: false });
    expect(state.audits).toHaveLength(1);
  });

  it("rejects another ordinary member, even when the record is visible", async () => {
    await expect(continueProtectedResume({ ...input, userId: "colleague" })).rejects.toMatchObject({
      status: 403,
    });
    expect(state.audits).toHaveLength(0);
  });

  it("allows a workspace administrator to confirm", async () => {
    await expect(
      continueProtectedResume({ ...input, memberRole: "admin", userId: "administrator" }),
    ).resolves.toBeDefined();
  });

  it.each([
    { resumeAdmissionStatus: "pending" },
    { resumeAdmissionStatus: "accepted" },
    { resumeParseStatus: "failed" },
    { outcome: "archived", pipelineStage: "closed" },
  ])("rejects ineligible state %j", async (patch) => {
    Object.assign(state.row ?? {}, patch);
    await expect(continueProtectedResume(input)).rejects.toMatchObject({ status: 409 });
    expect(state.audits).toHaveLength(0);
  });

  it("rejects a concurrently changed job instead of overwriting it", async () => {
    Object.assign(state.row ?? {}, { jobDescriptionId: "different-job" });
    await expect(continueProtectedResume(input)).rejects.toMatchObject({ status: 409 });
    expect(state.row?.jobDescriptionId).toBe("different-job");
    expect(state.audits).toHaveLength(0);
  });
  it("does not alter a missing or cross-workspace record", async () => {
    state.row = null;
    await expect(continueProtectedResume(input)).rejects.toMatchObject({ status: 404 });
  });
});
