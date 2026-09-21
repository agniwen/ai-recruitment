import { readFileSync } from "node:fs";
import type {
  HumanInterviewMeetingRecord,
  HumanInterviewRoundRecord,
} from "@arc/shared/studio-pipeline-stages";
import { describe, expect, it } from "vitest";
import {
  canCompleteHumanInterviewRound,
  canEditHumanInterviewEvaluation,
} from "./human-interview-stage-utils";

const dialogSource = readFileSync(
  new URL("human-interview-stage-dialogs.tsx", import.meta.url),
  "utf-8",
);

describe("human interview editing gates", () => {
  it("initializes scheduling from the configured interviewers and requires a selection", () => {
    expect(dialogSource).toContain("setInterviewerIds([...defaultInterviewerIds])");
    expect(dialogSource).toContain("interviewerIds,");
    expect(dialogSource).toContain("disabled={mutation.isPending || interviewerIds.length === 0}");
  });

  it("validates and trims feedback before submitting completion", () => {
    const validation = dialogSource.indexOf('throw new Error("请填写面试评价")');
    const submission = dialogSource.indexOf(": completeHumanInterviewRound(");
    expect(validation).toBeGreaterThan(0);
    expect(submission).toBeGreaterThan(validation);
    expect(dialogSource).toContain("feedback: trimmedFeedback");
  });

  it("allows completed evaluations to be edited while writes are enabled", () => {
    expect(
      canEditHumanInterviewEvaluation({ status: "completed" } as HumanInterviewRoundRecord),
    ).toBe(true);
    expect(
      canEditHumanInterviewEvaluation({ status: "completed" } as HumanInterviewRoundRecord, true),
    ).toBe(false);
    expect(
      canEditHumanInterviewEvaluation({ status: "pending" } as HumanInterviewRoundRecord),
    ).toBe(false);
    expect(dialogSource).toContain("patchHumanInterviewRound(slug, candidateId, round.id, input)");
  });

  it("updates the round cache and waits for candidate aggregates before closing", () => {
    const updateCache = dialogSource.indexOf(
      "queryClient.setQueryData<HumanInterviewRoundRecord[]>",
    );
    const refreshCandidate = dialogSource.indexOf(
      "await invalidateHumanInterviewCandidateQueries(queryClient, { candidateId, slug })",
    );
    const closeDialog = dialogSource.indexOf("handleOpenChange(false)", refreshCandidate);

    expect(updateCache).toBeGreaterThan(0);
    expect(refreshCandidate).toBeGreaterThan(updateCache);
    expect(closeDialog).toBeGreaterThan(refreshCandidate);
  });

  it("prompts candidate close only when the result changes to fail", () => {
    expect(dialogSource).toContain('updatedRound.outcome === "fail"');
    expect(dialogSource).toContain('(round?.status !== "completed" || round.outcome !== "fail")');
    expect(dialogSource.indexOf("onRejected?.()")).toBeGreaterThan(
      dialogSource.indexOf("handleOpenChange(false)"),
    );
  });

  it.each([
    ["pending", "ended", false, true],
    ["pending", "in_progress", false, false],
    ["pending", "scheduled", false, false],
    ["pending", null, false, false],
    ["completed", "ended", false, false],
    ["cancelled", "ended", false, false],
    ["pending", "ended", true, false],
  ] as const)(
    "completion gate: round %s, meeting %s, disabled %s",
    (status, meetingStatus, disabled, expected) => {
      const round = { status } as HumanInterviewRoundRecord;
      const meeting = meetingStatus
        ? ({ status: meetingStatus } as HumanInterviewMeetingRecord)
        : null;
      expect(canCompleteHumanInterviewRound(round, meeting, disabled)).toBe(expected);
    },
  );
});
