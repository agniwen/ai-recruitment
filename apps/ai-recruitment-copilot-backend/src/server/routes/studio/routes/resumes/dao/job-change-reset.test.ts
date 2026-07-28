import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateFormSubmission, studioInterviewSchedule } from "@arc/db-schema/schema";

const snapshotMocks = vi.hoisted(() => ({
  refreshInterviewContextSnapshot: vi.fn(),
}));
const evaluationMocks = vi.hoisted(() => ({
  resetResumeEvaluationForJobChangeInTransaction: vi.fn(),
}));

vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/context-snapshots",
  () => ({
    refreshInterviewContextSnapshot: snapshotMocks.refreshInterviewContextSnapshot,
  }),
);
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/resumes/dao/evaluation",
  () => ({
    resetResumeEvaluationForJobChangeInTransaction:
      evaluationMocks.resetResumeEvaluationForJobChangeInTransaction,
  }),
);

// oxlint-disable-next-line import/first -- must follow vi.mock() for hoisted module replacement.
import {
  applyJobDescriptionChangeEffects,
  JOB_DESCRIPTION_CHANGE_PIPELINE_RESET,
  resetCandidateWorkflowForJobDescriptionChange,
} from "./job-change-reset";

describe("resetCandidateWorkflowForJobDescriptionChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the candidate to screening while preserving stage history and resetting AI inputs", async () => {
    const scheduleRows = [
      {
        conversationId: "conversation-1",
        id: "round-1",
        roundLabel: "AI 一面",
        sortOrder: 1,
        status: "completed",
      },
      {
        conversationId: null,
        id: "round-2",
        roundLabel: "AI 二面",
        sortOrder: 2,
        status: "pending",
      },
    ];
    const scheduleUpdates: Record<string, unknown>[] = [];
    const updatedTables: unknown[] = [];
    const auditRows: Record<string, unknown>[] = [];
    const deletedTables: unknown[] = [];
    const tx = {
      delete: (table: unknown) => {
        deletedTables.push(table);
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: "submission-1" }]),
          }),
        };
      },
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          auditRows.push(value);
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve(scheduleRows),
          }),
        }),
      }),
      update: (table: unknown) => {
        updatedTables.push(table);
        return {
          set: (patch: Record<string, unknown>) => ({
            where: () => {
              scheduleUpdates.push(patch);
              return Promise.resolve();
            },
          }),
        };
      },
    };
    snapshotMocks.refreshInterviewContextSnapshot.mockImplementation(
      (_tx: unknown, input: { scheduleEntryId: string }) =>
        Promise.resolve({
          id: `snapshot-${input.scheduleEntryId}`,
          version: 2,
        }),
    );

    const result = await resetCandidateWorkflowForJobDescriptionChange(tx as never, {
      interviewRecordId: "resume-1",
      operatorId: "user-1",
      organizationId: "org-1",
    });

    expect(JOB_DESCRIPTION_CHANGE_PIPELINE_RESET).toEqual({
      closedAt: null,
      closedMeta: null,
      closedReason: null,
      outcome: "in_pipeline",
      pipelineStage: "screening",
    });
    expect(deletedTables).toEqual([candidateFormSubmission]);
    expect(updatedTables).toEqual([studioInterviewSchedule, studioInterviewSchedule]);
    expect(scheduleUpdates).toEqual([
      expect.objectContaining({
        conversationId: null,
        disconnectedAt: null,
        liveKitParticipantIdentity: null,
        liveKitRoomName: null,
        sessionStartedAt: null,
        status: "pending",
      }),
      expect.objectContaining({
        conversationId: null,
        disconnectedAt: null,
        liveKitParticipantIdentity: null,
        liveKitRoomName: null,
        sessionStartedAt: null,
        status: "pending",
      }),
    ]);
    expect(snapshotMocks.refreshInterviewContextSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshotMocks.refreshInterviewContextSnapshot).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        interviewRecordId: "resume-1",
        reason: "reset",
        scheduleEntryId: "round-1",
      }),
    );
    expect(auditRows).toHaveLength(2);
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        action: "round_reset",
        detail: expect.objectContaining({
          previousConversationId: "conversation-1",
          previousStatus: "completed",
          reason: "job_description_changed",
        }),
        interviewRecordId: "resume-1",
        scheduleEntryId: "round-1",
      }),
    );
    expect(result).toEqual({
      resetAiRoundCount: 2,
      resetFormSubmissionCount: 1,
    });
  });

  it("applies the workflow, evaluation, and audit resets in the caller transaction", async () => {
    const auditRows: Record<string, unknown>[] = [];
    const tx = {
      delete: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          auditRows.push(value);
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([]),
          }),
        }),
      }),
      update: vi.fn(),
    };

    await applyJobDescriptionChangeEffects(tx as never, {
      interviewRecordId: "resume-1",
      nextJobDescriptionId: "job-new",
      nextJobDescriptionName: "新岗位",
      operatorId: "user-1",
      organizationId: "org-1",
      previousEvaluationStatus: "pass",
      previousJobDescriptionId: "job-old",
      previousJobDescriptionName: "旧岗位",
    });

    expect(evaluationMocks.resetResumeEvaluationForJobChangeInTransaction).toHaveBeenCalledWith(
      tx,
      {
        id: "resume-1",
        nextJobDescriptionId: "job-new",
        operatorId: "user-1",
        organizationId: "org-1",
        previousJobDescriptionId: "job-old",
        previousStatus: "pass",
      },
    );
    expect(auditRows).toContainEqual(
      expect.objectContaining({
        action: "job_description_changed",
        detail: {
          fromJobDescriptionId: "job-old",
          fromJobDescriptionName: "旧岗位",
          toJobDescriptionId: "job-new",
          toJobDescriptionName: "新岗位",
        },
      }),
    );
  });
});
