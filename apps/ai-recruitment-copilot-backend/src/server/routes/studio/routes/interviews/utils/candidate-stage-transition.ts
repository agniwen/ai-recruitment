import { and, eq, sql } from "drizzle-orm";
import type { WorkspaceAuthorizer } from "@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { invalidateStudioInterviewCaches } from "@arc/ai-recruitment-copilot-backend/server/cache-tags";
import {
  getHumanInterviewOfferReadinessError,
  loadHumanInterviewRoundReadiness,
} from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/human-interview-rounds";
import { interviewAuditLog, jobDescription, studioInterview } from "@arc/db-schema/schema";
import {
  getCandidateHiredDetailsError,
  getCandidateReactivationError,
  getCandidateStageTransitionError,
  resolveCandidateTransitionPatch,
} from "./candidate-transition";
import type { CandidateTransitionInput } from "./candidate-transition";
import { notifyCandidateStageChange } from "./candidate-stage-notification";
import { refreshDirectUploadDuplicateMatchesBeforeHire } from "./direct-upload-dedup-refresh";
import { autoCloseRelatedCandidatesAfterHire } from "./related-candidate-auto-closure";

export type CandidateStageTransitionProvenance =
  | { kind: "manual" }
  | {
      kind: "workspace_recruiting_copilot";
      proposalId: string;
      proposalTitle: string;
    };

export type CandidateStageTransitionResult =
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid"; message: string }
  | { kind: "noop" }
  | { kind: "ok" };

/**
 * Stage-specific transition auth:
 * - offer / human_interview / closed use their own create verbs so late-stage
 *   roles are not forced through interview:update
 * - every other transition (AI stage, reactivate, …) stays on interview:update
 */
function resolveTransitionPermission(target: CandidateTransitionInput["pipelineStage"]) {
  if (target === "human_interview") {
    return { action: "create", resource: "humanInterview" } as const;
  }
  if (target === "offer") {
    return { action: "create", resource: "offer" } as const;
  }
  if (target === "closed") {
    return { action: "create", resource: "candidateClose" } as const;
  }
  return { action: "update", resource: "interview" } as const;
}

function resolveOnboardingFactPatch(input: {
  isHired: boolean;
  isReactivating: boolean;
  joiningDate: string | null | undefined;
  now: Date;
  operatorId: string | null;
  operatorRole?: string | null;
}) {
  if (input.isHired) {
    const parsedJoiningDate = input.joiningDate
      ? new Date(
          /^\d{4}-\d{2}-\d{2}$/u.test(input.joiningDate)
            ? `${input.joiningDate}T00:00:00+08:00`
            : input.joiningDate,
        )
      : null;
    return {
      actualOnboardedAt:
        parsedJoiningDate && !Number.isNaN(parsedJoiningDate.getTime())
          ? parsedJoiningDate
          : input.now,
      onboardedConfirmedAt: input.now,
      onboardedConfirmedBy: input.operatorId,
      onboardedConfirmedByRole: input.operatorRole ?? null,
    };
  }
  if (input.isReactivating) {
    return {
      actualOnboardedAt: null,
      onboardedConfirmedAt: null,
      onboardedConfirmedBy: null,
      onboardedConfirmedByRole: null,
    };
  }
  return {};
}

export async function transitionCandidateStage(command: {
  authorize: WorkspaceAuthorizer;
  candidateId: string;
  input: CandidateTransitionInput;
  operatorId: string | null;
  operatorRole?: string | null;
  organizationId: string;
  provenance: CandidateStageTransitionProvenance;
}): Promise<CandidateStageTransitionResult> {
  const transitionPermission = resolveTransitionPermission(command.input.pipelineStage);
  if (!(await command.authorize(transitionPermission))) {
    return { kind: "forbidden" };
  }

  const hiredDetailsError = getCandidateHiredDetailsError(command.input);
  if (hiredDetailsError) {
    return { kind: "invalid", message: hiredDetailsError };
  }

  const isHiringCandidate =
    command.input.pipelineStage === "closed" && command.input.outcome === "hired";
  const refreshedSemanticMatches = isHiringCandidate
    ? await refreshDirectUploadDuplicateMatchesBeforeHire({
        candidateId: command.candidateId,
        organizationId: command.organizationId,
      })
    : undefined;
  const now = new Date();
  // oxlint-disable-next-line complexity -- Transaction enforces the full candidate-stage state machine atomically.
  const result = await db.transaction(async (tx) => {
    if (isHiringCandidate) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`candidate-hire:${command.organizationId}`}, 0))`,
      );
    }
    const [existing] = await tx
      .select({
        candidateName: studioInterview.candidateName,
        closedMeta: studioInterview.closedMeta,
        jobDescriptionAiInterviewDisabled: jobDescription.aiInterviewDisabled,
        jobDescriptionId: studioInterview.jobDescriptionId,
        outcome: studioInterview.outcome,
        pipelineStage: studioInterview.pipelineStage,
        resumeSourcePoolItemId: studioInterview.resumeSourcePoolItemId,
        resumeSourceType: studioInterview.resumeSourceType,
      })
      .from(studioInterview)
      .leftJoin(
        jobDescription,
        and(
          eq(studioInterview.jobDescriptionId, jobDescription.id),
          eq(jobDescription.organizationId, studioInterview.organizationId),
        ),
      )
      .where(
        and(
          eq(studioInterview.id, command.candidateId),
          eq(studioInterview.organizationId, command.organizationId),
        ),
      )
      .for("update", { of: studioInterview })
      .limit(1);
    if (!existing) {
      return { kind: "not_found" } as const;
    }

    const reactivationError = getCandidateReactivationError({
      from: existing.pipelineStage,
      reactivationReason: command.input.reactivationReason,
      to: command.input.pipelineStage,
    });
    if (reactivationError) {
      return { kind: "invalid", message: reactivationError } as const;
    }
    if (
      command.input.pipelineStage === "ai_interview" &&
      existing.jobDescriptionAiInterviewDisabled
    ) {
      return { kind: "invalid", message: "当前关联岗位已禁用 AI 面试。" } as const;
    }

    let humanInterviewOfferReadinessError: string | null = null;
    let humanInterviewReadyForOffer = false;
    if (existing.pipelineStage === "human_interview" && command.input.pipelineStage === "offer") {
      const readiness = await loadHumanInterviewRoundReadiness(
        command.candidateId,
        command.organizationId,
        tx,
      );
      humanInterviewOfferReadinessError = getHumanInterviewOfferReadinessError(readiness);
      humanInterviewReadyForOffer = !humanInterviewOfferReadinessError;
    }
    const stageTransitionError = getCandidateStageTransitionError({
      from: existing.pipelineStage,
      hasJobDescription: Boolean(existing.jobDescriptionId),
      humanInterviewReadyForOffer,
      to: command.input.pipelineStage,
    });
    if (stageTransitionError) {
      return {
        kind: "invalid",
        message: humanInterviewOfferReadinessError ?? stageTransitionError,
      } as const;
    }

    if (
      existing.pipelineStage === command.input.pipelineStage &&
      existing.outcome === (command.input.outcome ?? "in_pipeline")
    ) {
      return { kind: "noop" } as const;
    }
    if (isHiringCandidate && existing.outcome !== "in_pipeline") {
      return {
        kind: "invalid",
        message: "该候选人已结束流程，不能再次标记录用。",
      } as const;
    }

    const transition = resolveCandidateTransitionPatch({
      existing,
      input: command.input,
      now,
    });
    const isHired = command.input.pipelineStage === "closed" && command.input.outcome === "hired";
    const isReactivating =
      existing.pipelineStage === "closed" && command.input.pipelineStage !== "closed";
    const onboardingFactPatch = resolveOnboardingFactPatch({
      isHired,
      isReactivating,
      joiningDate: command.input.closedMeta?.hiredDetails?.joiningDate,
      now,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole,
    });
    await tx
      .update(studioInterview)
      .set({
        ...transition.patch,
        ...onboardingFactPatch,
      })
      .where(eq(studioInterview.id, command.candidateId));
    const automaticallyClosedCandidates = isHired
      ? await autoCloseRelatedCandidatesAfterHire({
          hiredCandidate: {
            id: command.candidateId,
            name: existing.candidateName,
            poolItemId: existing.resumeSourcePoolItemId,
            sourceType: existing.resumeSourceType,
          },
          now,
          operatorId: command.operatorId,
          operatorRole: command.operatorRole,
          organizationId: command.organizationId,
          refreshedSemanticMatches,
          tx,
        })
      : [];
    const provenanceDetail =
      command.provenance.kind === "workspace_recruiting_copilot"
        ? {
            copilotActionProposalId: command.provenance.proposalId,
            copilotActionTitle: command.provenance.proposalTitle,
            source: "workspace_recruiting_copilot" as const,
          }
        : {};
    const automaticClosureDetail = isHired
      ? {
          automaticallyClosedCandidateCount: automaticallyClosedCandidates.length,
          automaticallyClosedCandidateIds: automaticallyClosedCandidates.map(
            (candidate) => candidate.candidateId,
          ),
        }
      : {};
    await tx.insert(interviewAuditLog).values({
      action: "candidate_transition",
      createdAt: now,
      detail: {
        ...transition.auditDetail,
        ...provenanceDetail,
        ...automaticClosureDetail,
      },
      id: crypto.randomUUID(),
      interviewRecordId: command.candidateId,
      operatorId: command.operatorId,
      operatorRole: command.operatorRole ?? null,
      organizationId: command.organizationId,
      scheduleEntryId: null,
      source: command.provenance.kind === "workspace_recruiting_copilot" ? "agent" : "manual",
    });
    return {
      kind: "ok",
      notification: {
        fromOutcome: existing.outcome,
        fromStage: existing.pipelineStage,
        toOutcome: transition.patch.outcome,
        toStage: transition.patch.pipelineStage,
      },
    } as const;
  });

  if (result.kind === "ok") {
    invalidateStudioInterviewCaches(command.organizationId);
    await notifyCandidateStageChange({
      candidateId: command.candidateId,
      organizationId: command.organizationId,
      ...result.notification,
    });
    return { kind: "ok" };
  }
  return result;
}
