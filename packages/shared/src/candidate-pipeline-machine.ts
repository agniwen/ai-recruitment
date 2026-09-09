import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";
import { setup, transition } from "xstate";

export type CandidatePipelineEventType =
  | "APPROVE_AI_REVIEW"
  | "START_AI_INTERVIEW"
  | "SKIP_TO_HUMAN_INTERVIEW"
  | "ADVANCE_TO_HUMAN_INTERVIEW"
  | "ADVANCE_TO_OFFER"
  | "CLOSE"
  | "REACTIVATE";

export type CandidatePipelineEvent =
  | { type: "APPROVE_AI_REVIEW" }
  | { type: "START_AI_INTERVIEW" }
  | { type: "SKIP_TO_HUMAN_INTERVIEW" }
  | { type: "ADVANCE_TO_HUMAN_INTERVIEW" }
  | { type: "ADVANCE_TO_OFFER" }
  | { outcome: Exclude<CandidateOutcome, "in_pipeline">; type: "CLOSE" }
  | { target: Exclude<PipelineStage, "closed">; type: "REACTIVATE" };

export interface CandidatePipelineSnapshot {
  humanInterviewReadyForOffer: boolean;
  stage: PipelineStage;
}

interface CandidatePipelineContext {
  humanInterviewReadyForOffer: boolean;
}

export interface CandidatePipelineResult {
  outcome: CandidateOutcome;
  stage: PipelineStage;
}

export function getCandidateActivityStatus(stage: PipelineStage): "active" | "archived" {
  return stage === "closed" ? "archived" : "active";
}

type ReactivationTarget = Exclude<PipelineStage, "closed">;

export const candidatePipelineMachine = setup({
  guards: {
    humanInterviewReadyForOffer: ({ context }) => context.humanInterviewReadyForOffer,
    reactivatesTo: ({ event }, params: { target: ReactivationTarget }) =>
      event.type === "REACTIVATE" && event.target === params.target,
  },
  types: {
    context: {} as CandidatePipelineContext,
    events: {} as CandidatePipelineEvent,
  },
}).createMachine({
  context: {
    humanInterviewReadyForOffer: false,
  },
  id: "candidatePipeline",
  initial: "ai_review",
  states: {
    ai_interview: {
      on: {
        ADVANCE_TO_HUMAN_INTERVIEW: { target: "human_interview" },
        CLOSE: { target: "closed" },
      },
    },
    ai_review: { on: { APPROVE_AI_REVIEW: { target: "screening" }, CLOSE: { target: "closed" } } },
    closed: {
      on: {
        REACTIVATE: [
          {
            guard: { params: { target: "ai_review" }, type: "reactivatesTo" },
            target: "ai_review",
          },
          {
            guard: { params: { target: "screening" }, type: "reactivatesTo" },
            target: "screening",
          },
          {
            guard: { params: { target: "written_test" }, type: "reactivatesTo" },
            target: "written_test",
          },
          {
            guard: { params: { target: "ai_interview" }, type: "reactivatesTo" },
            target: "ai_interview",
          },
          {
            guard: { params: { target: "human_interview" }, type: "reactivatesTo" },
            target: "human_interview",
          },
          {
            guard: { params: { target: "offer" }, type: "reactivatesTo" },
            target: "offer",
          },
        ],
      },
    },
    human_interview: {
      on: {
        ADVANCE_TO_OFFER: {
          guard: "humanInterviewReadyForOffer",
          target: "offer",
        },
        CLOSE: { target: "closed" },
      },
    },
    offer: {
      on: {
        CLOSE: { target: "closed" },
      },
    },
    screening: {
      on: {
        CLOSE: { target: "closed" },
        SKIP_TO_HUMAN_INTERVIEW: { target: "human_interview" },
        START_AI_INTERVIEW: { target: "ai_interview" },
      },
    },
    written_test: {
      on: {
        CLOSE: { target: "closed" },
        SKIP_TO_HUMAN_INTERVIEW: { target: "human_interview" },
        START_AI_INTERVIEW: { target: "ai_interview" },
      },
    },
  },
});

function resolveCandidatePipelineSnapshot(snapshot: CandidatePipelineSnapshot) {
  return candidatePipelineMachine.resolveState({
    context: {
      humanInterviewReadyForOffer: snapshot.humanInterviewReadyForOffer,
    },
    value: snapshot.stage,
  });
}

export function getCandidatePipelineEventResult(
  snapshot: CandidatePipelineSnapshot,
  event: CandidatePipelineEvent,
): CandidatePipelineResult | null {
  const currentSnapshot = resolveCandidatePipelineSnapshot(snapshot);
  if (!currentSnapshot.can(event)) {
    return null;
  }

  const [nextSnapshot] = transition(candidatePipelineMachine, currentSnapshot, event);

  if (nextSnapshot.value === currentSnapshot.value) {
    return null;
  }

  return {
    outcome: event.type === "CLOSE" ? event.outcome : "in_pipeline",
    stage: nextSnapshot.value as PipelineStage,
  };
}

export function canApplyCandidatePipelineEvent(
  snapshot: CandidatePipelineSnapshot,
  event: CandidatePipelineEvent,
): boolean {
  return resolveCandidatePipelineSnapshot(snapshot).can(event);
}

export function getCandidatePipelineEventForTargetStage({
  from,
  to,
}: {
  from: PipelineStage;
  to: PipelineStage;
}): CandidatePipelineEvent | null {
  if (to === "closed") {
    return null;
  }
  if (from === "closed") {
    return { target: to, type: "REACTIVATE" };
  }
  if (from === "ai_review" && to === "screening") {
    return { type: "APPROVE_AI_REVIEW" };
  }
  if (from === "screening" || from === "written_test") {
    if (to === "ai_interview") {
      return { type: "START_AI_INTERVIEW" };
    }
    if (to === "human_interview") {
      return { type: "SKIP_TO_HUMAN_INTERVIEW" };
    }
    return null;
  }
  if (from === "ai_interview" && to === "human_interview") {
    return { type: "ADVANCE_TO_HUMAN_INTERVIEW" };
  }
  if (from === "human_interview" && to === "offer") {
    return { type: "ADVANCE_TO_OFFER" };
  }
  return null;
}
