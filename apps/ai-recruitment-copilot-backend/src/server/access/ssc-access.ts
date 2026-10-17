import { and, eq, exists, gt, inArray, ne, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  jobDescription,
  member,
  organizationRole,
  resumeSource,
  sscResponsibility,
  studioInterview,
  studioInterviewSchedule,
  studioOfferDraft,
  user,
} from "@arc/db-schema/schema";

export interface SscAccessActor {
  organizationId: string;
  userId: string;
}

type Executor = Pick<typeof db, "select">;

export function buildSscCandidateVisibilityCondition(actor: SscAccessActor) {
  const sscMember = alias(member, "ssc_access_member");
  const sscRole = alias(organizationRole, "ssc_access_role");
  const sscUser = alias(user, "ssc_access_user");
  const otherUser = alias(user, "ssc_access_other_user");
  const responsibility = alias(sscResponsibility, "ssc_access_responsibility");
  const source = alias(resumeSource, "ssc_access_source");
  const job = alias(jobDescription, "ssc_access_job");
  const offer = alias(studioOfferDraft, "ssc_access_offer");
  const newerOffer = alias(studioOfferDraft, "ssc_access_newer_offer");
  const condition = and(
    eq(studioInterview.organizationId, actor.organizationId),
    exists(
      db
        .select({ value: sql`1` })
        .from(sscMember)
        .innerJoin(sscUser, eq(sscUser.id, sscMember.userId))
        .innerJoin(
          sscRole,
          and(
            eq(sscRole.organizationId, sscMember.organizationId),
            eq(sscRole.role, sscMember.role),
            eq(sscRole.isSsc, true),
          ),
        )
        .innerJoin(
          responsibility,
          and(
            eq(responsibility.organizationId, sscMember.organizationId),
            eq(responsibility.workspaceRole, sscMember.role),
            sql`btrim(${responsibility.email}) <> ''`,
            sql`lower(btrim(${responsibility.email})) = lower(btrim(${sscUser.email}))`,
          ),
        )
        .innerJoin(
          source,
          and(
            eq(source.organizationId, responsibility.organizationId),
            eq(source.id, responsibility.resumeSourceId),
          ),
        )
        .innerJoin(
          job,
          and(
            eq(job.organizationId, source.organizationId),
            eq(job.resumeSourceId, source.id),
            eq(job.id, studioInterview.jobDescriptionId),
          ),
        )
        .where(
          and(
            eq(sscMember.organizationId, actor.organizationId),
            eq(sscMember.userId, actor.userId),
            eq(sscUser.banned, false),
            notExists(
              db
                .select({ value: sql`1` })
                .from(otherUser)
                .where(
                  and(
                    ne(otherUser.id, sscUser.id),
                    sql`lower(btrim(${otherUser.email})) = lower(btrim(${sscUser.email}))`,
                  ),
                ),
            ),
          ),
        ),
    ),
    exists(
      db
        .select({ value: sql`1` })
        .from(offer)
        .where(
          and(
            eq(offer.organizationId, actor.organizationId),
            eq(offer.interviewRecordId, studioInterview.id),
            inArray(offer.sscConfirmationStatus, ["pending", "confirming", "completed"]),
            notInArray(offer.status, ["deleted", "superseded", "expired"]),
            // Include tombstones when finding a newer version. Removing the
            // latest Offer must never revive visibility through an older one.
            notExists(
              db
                .select({ value: sql`1` })
                .from(newerOffer)
                .where(
                  and(
                    eq(newerOffer.organizationId, offer.organizationId),
                    eq(newerOffer.interviewRecordId, offer.interviewRecordId),
                    gt(newerOffer.version, offer.version),
                  ),
                ),
            ),
          ),
        ),
    ),
  );
  return condition ?? sql`false`;
}

async function hasAssignedSscRole(
  organizationId: string,
  memberRole: string | null | undefined,
  executor: Executor,
): Promise<boolean> {
  const assignedRoles =
    memberRole
      ?.split(",")
      .map((role) => role.trim())
      .filter(Boolean) ?? [];
  if (!memberRole?.includes(",") || assignedRoles.length === 0) {
    return false;
  }
  const [sscRole] = await executor
    .select({ role: organizationRole.role })
    .from(organizationRole)
    .where(
      and(
        eq(organizationRole.organizationId, organizationId),
        eq(organizationRole.isSsc, true),
        inArray(organizationRole.role, assignedRoles),
      ),
    )
    .limit(1);
  return Boolean(sscRole);
}

export async function resolveSscAccessActor(
  input: SscAccessActor & { currentRole?: string | null },
  executor: Executor = db,
): Promise<SscAccessActor | null> {
  // Built-in non-SSC roles cannot carry dynamic SSC metadata. The request's
  // current membership is supplied by the workspace middleware.
  if (input.currentRole && ["owner", "admin", "member"].includes(input.currentRole)) {
    return null;
  }
  const [profile] = await executor
    .select({
      configuredRole: organizationRole.role,
      email: user.email,
      isSsc: organizationRole.isSsc,
      memberId: member.id,
      role: member.role,
    })
    .from(user)
    .leftJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, input.organizationId)),
    )
    .leftJoin(
      organizationRole,
      and(
        eq(organizationRole.organizationId, member.organizationId),
        eq(organizationRole.role, member.role),
      ),
    )
    .where(eq(user.id, input.userId))
    .limit(1);
  if (profile?.role && ["owner", "admin", "member"].includes(profile.role)) {
    return null;
  }
  if (profile?.isSsc) {
    return { organizationId: input.organizationId, userId: input.userId };
  }
  // Better Auth invitations can contain multiple comma-separated roles. Any
  // live SSC role must retain the SSC boundary; mixed roles deliberately do
  // not match the single-role grant predicate and therefore receive no data.
  if (await hasAssignedSscRole(input.organizationId, profile?.role, executor)) {
    return { organizationId: input.organizationId, userId: input.userId };
  }
  if (profile && (!profile.memberId || profile.role === "noAccess" || !profile.configuredRole)) {
    const [knownEntry] = await executor
      .select({ id: sscResponsibility.id })
      .from(sscResponsibility)
      .where(
        and(
          eq(sscResponsibility.organizationId, input.organizationId),
          sql`btrim(${sscResponsibility.email}) <> ''`,
          sql`lower(btrim(${sscResponsibility.email})) = lower(btrim(${profile.email}))`,
        ),
      )
      .limit(1);
    if (knownEntry) {
      return { organizationId: input.organizationId, userId: input.userId };
    }
  }
  return null;
}

export async function isSscCandidateVisible(
  input: { actor: SscAccessActor; candidateId: string; draftId?: string },
  executor: Executor = db,
): Promise<boolean> {
  const [candidate] = await executor
    .select({ id: studioInterview.id })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, input.candidateId),
        buildSscCandidateVisibilityCondition(input.actor),
        input.draftId
          ? exists(
              db
                .select({ value: sql`1` })
                .from(studioOfferDraft)
                .where(
                  and(
                    eq(studioOfferDraft.id, input.draftId),
                    eq(studioOfferDraft.organizationId, input.actor.organizationId),
                    eq(studioOfferDraft.interviewRecordId, input.candidateId),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .limit(1);
  return Boolean(candidate);
}

export async function findSscPublicCandidate(
  input: { id: string; round?: boolean },
  executor: Executor = db,
): Promise<{ candidateId: string; organizationId: string } | null> {
  if (input.round) {
    const [round] = await executor
      .select({
        candidateId: studioInterviewSchedule.interviewRecordId,
        organizationId: studioInterviewSchedule.organizationId,
      })
      .from(studioInterviewSchedule)
      .where(eq(studioInterviewSchedule.id, input.id))
      .limit(1);
    if (round) {
      return round;
    }
  }
  const [candidate] = await executor
    .select({
      candidateId: studioInterview.id,
      organizationId: studioInterview.organizationId,
    })
    .from(studioInterview)
    .where(eq(studioInterview.id, input.id))
    .limit(1);
  return candidate ?? null;
}
