import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  interviewAuditLog,
  jobDescription,
  organizationRole,
  studioHumanInterviewRound,
  studioInterview,
  studioInterviewSchedule,
  studioOfferDraft,
} from "@arc/db-schema/schema";
import type {
  OdcAnalysisData,
  OdcAnalysisDayCount,
  OdcAnalysisFilters,
  OdcAnalysisJobOption,
  OdcAnalysisMetric,
} from "@arc/shared/odc-analysis";
import { toBeijingDayKey } from "@arc/shared/beijing-calendar";
import { addCalendarDays, beijingDayStart, resolveOdcAnalysisRange } from "./date-range";
import type { InstantRange } from "./date-range";
import {
  countFirstSentOffers,
  countUniqueAiCandidates,
  CURRENT_PENDING_EVALUATION_FACT,
  latestOfferByInterview,
} from "./metric-policies";
import { instantRangeConditions } from "./utils/instant-range-conditions";
import { matchesOdcRole, odcRoleCondition } from "./utils/role-filter";

export { resolveOdcAnalysisRange } from "./date-range";

export class OdcAnalysisFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdcAnalysisFilterError";
  }
}

function metric(
  value: number,
  unit: OdcAnalysisMetric["unit"],
  breakdown?: Record<string, number>,
): OdcAnalysisMetric {
  return breakdown ? { breakdown, unit, value } : { unit, value };
}

function inRange(value: Date | null, range: InstantRange): boolean {
  if (!value) {
    return false;
  }
  return (!range.start || value >= range.start) && (!range.end || value < range.end);
}

function selectedJobCondition(jobIds: string[]) {
  return jobIds.length > 0 ? inArray(studioInterview.jobDescriptionId, jobIds) : sql`false`;
}

function timestampCondition(
  column: Parameters<typeof instantRangeConditions>[0],
  range: InstantRange,
) {
  return and(...instantRangeConditions(column, range)) ?? sql`true`;
}

function loadSelectedJobs(organizationId: string) {
  return db
    .select({
      code: jobDescription.code,
      expectedOnboardDate: jobDescription.expectedOnboardDate,
      headcount: jobDescription.headcount,
      id: jobDescription.id,
      name: jobDescription.name,
      recruitmentStatus: jobDescription.recruitmentStatus,
      requestedDate: jobDescription.requestedDate,
    })
    .from(jobDescription)
    .where(eq(jobDescription.organizationId, organizationId))
    .orderBy(asc(jobDescription.name));
}

export function loadOdcAnalysisJobOptions(organizationId: string): Promise<OdcAnalysisJobOption[]> {
  return db
    .select({
      code: jobDescription.code,
      id: jobDescription.id,
      name: jobDescription.name,
      recruitmentStatus: jobDescription.recruitmentStatus,
    })
    .from(jobDescription)
    .where(eq(jobDescription.organizationId, organizationId))
    .orderBy(asc(jobDescription.name));
}

async function loadOdcRoleNames(organizationId: string): Promise<string[]> {
  const roles = await db
    .select({ role: organizationRole.role })
    .from(organizationRole)
    .where(
      and(eq(organizationRole.organizationId, organizationId), eq(organizationRole.isOdc, true)),
    );
  return roles.map(({ role }) => role);
}

function latestTransitionRoleCondition(odcRoles: readonly string[]) {
  const latestRole = sql`(
    SELECT ${interviewAuditLog.operatorRole}
    FROM ${interviewAuditLog}
    WHERE ${interviewAuditLog.organizationId} = ${studioInterview.organizationId}
      AND ${interviewAuditLog.interviewRecordId} = ${studioInterview.id}
      AND ${interviewAuditLog.action} = 'candidate_transition'
      AND (${interviewAuditLog.detail} ->> 'toOutcome') = ${studioInterview.outcome}
    ORDER BY ${interviewAuditLog.createdAt} DESC
    LIMIT 1
  )`;
  return odcRoleCondition(latestRole, odcRoles);
}

// oxlint-disable-next-line complexity -- A single aggregate query intentionally keeps all dashboard counters on one snapshot.
async function loadCandidateMetrics(
  organizationId: string,
  progressJobIds: string[],
  progressRange: InstantRange,
  activityJobIds: string[],
  activityRange: InstantRange,
  odcRoles: readonly string[],
) {
  const [row] = await db
    .select({
      associated: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.resumeParseStatus, "ready"),
        selectedJobCondition(progressJobIds),
        timestampCondition(studioInterview.createdAt, progressRange),
        odcRoleCondition(studioInterview.createdByRole, odcRoles),
      )})`.mapWith(Number),
      onboarded: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "hired"),
        isNotNull(studioInterview.actualOnboardedAt),
        selectedJobCondition(progressJobIds),
        odcRoleCondition(studioInterview.onboardedConfirmedByRole, odcRoles),
        ...instantRangeConditions(studioInterview.actualOnboardedAt, progressRange),
      )})`.mapWith(Number),
      pendingEvaluation: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.pipelineStage, CURRENT_PENDING_EVALUATION_FACT.pipelineStage),
        eq(studioInterview.outcome, CURRENT_PENDING_EVALUATION_FACT.outcome),
        eq(studioInterview.resumeParseStatus, "ready"),
        isNull(studioInterview.resumeEvaluationStatus),
        selectedJobCondition(progressJobIds),
        odcRoleCondition(studioInterview.createdByRole, odcRoles),
        ...instantRangeConditions(studioInterview.createdAt, progressRange),
      )})`.mapWith(Number),
      rejected: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "rejected"),
        selectedJobCondition(progressJobIds),
        latestTransitionRoleCondition(odcRoles),
        ...instantRangeConditions(studioInterview.closedAt, progressRange),
      )})`.mapWith(Number),
      todayAssociated: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.resumeParseStatus, "ready"),
        selectedJobCondition(activityJobIds),
        timestampCondition(studioInterview.createdAt, activityRange),
        odcRoleCondition(studioInterview.createdByRole, odcRoles),
      )})`.mapWith(Number),
      todayOnboarded: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "hired"),
        isNotNull(studioInterview.actualOnboardedAt),
        selectedJobCondition(activityJobIds),
        odcRoleCondition(studioInterview.onboardedConfirmedByRole, odcRoles),
        ...instantRangeConditions(studioInterview.actualOnboardedAt, activityRange),
      )})`.mapWith(Number),
      todayPendingEvaluation: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.pipelineStage, CURRENT_PENDING_EVALUATION_FACT.pipelineStage),
        eq(studioInterview.outcome, CURRENT_PENDING_EVALUATION_FACT.outcome),
        eq(studioInterview.resumeParseStatus, "ready"),
        isNull(studioInterview.resumeEvaluationStatus),
        selectedJobCondition(activityJobIds),
        odcRoleCondition(studioInterview.createdByRole, odcRoles),
        ...instantRangeConditions(studioInterview.createdAt, activityRange),
      )})`.mapWith(Number),
      todayRejected: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "rejected"),
        selectedJobCondition(activityJobIds),
        latestTransitionRoleCondition(odcRoles),
        ...instantRangeConditions(studioInterview.closedAt, activityRange),
      )})`.mapWith(Number),
      todayWithdrawn: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "withdrawn"),
        selectedJobCondition(activityJobIds),
        latestTransitionRoleCondition(odcRoles),
        ...instantRangeConditions(studioInterview.closedAt, activityRange),
      )})`.mapWith(Number),
      withdrawn: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "withdrawn"),
        selectedJobCondition(progressJobIds),
        latestTransitionRoleCondition(odcRoles),
        ...instantRangeConditions(studioInterview.closedAt, progressRange),
      )})`.mapWith(Number),
    })
    .from(studioInterview)
    .where(eq(studioInterview.organizationId, organizationId));

  return {
    associated: row?.associated ?? 0,
    onboarded: row?.onboarded ?? 0,
    pendingEvaluation: row?.pendingEvaluation ?? 0,
    rejected: row?.rejected ?? 0,
    todayAssociated: row?.todayAssociated ?? 0,
    todayOnboarded: row?.todayOnboarded ?? 0,
    todayPendingEvaluation: row?.todayPendingEvaluation ?? 0,
    todayRejected: row?.todayRejected ?? 0,
    todayWithdrawn: row?.todayWithdrawn ?? 0,
    withdrawn: row?.withdrawn ?? 0,
  };
}

async function loadDemandOnboarded(
  organizationId: string,
  jobIds: string[],
  odcRoles: readonly string[],
): Promise<number> {
  if (jobIds.length === 0) {
    return 0;
  }
  const [row] = await db
    .select({ value: count() })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.organizationId, organizationId),
        inArray(studioInterview.jobDescriptionId, jobIds),
        eq(studioInterview.outcome, "hired"),
        isNotNull(studioInterview.actualOnboardedAt),
        odcRoleCondition(studioInterview.onboardedConfirmedByRole, odcRoles),
      ),
    );
  return row?.value ?? 0;
}

async function loadAiMetrics(
  organizationId: string,
  progressJobIds: string[],
  progressRange: InstantRange,
  activityJobIds: string[],
  activityRange: InstantRange,
  futureRange: InstantRange,
  futureDays: string[],
  odcRoles: readonly string[],
) {
  const [[row], futureRows] = await Promise.all([
    db
      .select({
        overall:
          sql<number>`COUNT(DISTINCT ${studioInterviewSchedule.interviewRecordId}) FILTER (WHERE ${and(
            ne(studioInterviewSchedule.status, "cancelled"),
            selectedJobCondition(progressJobIds),
            ...instantRangeConditions(studioInterviewSchedule.scheduledAt, progressRange),
          )})`.mapWith(Number),
        today:
          sql<number>`COUNT(DISTINCT ${studioInterviewSchedule.interviewRecordId}) FILTER (WHERE ${and(
            ne(studioInterviewSchedule.status, "cancelled"),
            selectedJobCondition(activityJobIds),
            ...instantRangeConditions(studioInterviewSchedule.scheduledAt, activityRange),
          )})`.mapWith(Number),
      })
      .from(studioInterviewSchedule)
      .innerJoin(studioInterview, eq(studioInterview.id, studioInterviewSchedule.interviewRecordId))
      .where(
        and(
          eq(studioInterviewSchedule.organizationId, organizationId),
          odcRoleCondition(studioInterviewSchedule.createdByRole, odcRoles),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(${studioInterviewSchedule.scheduledAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')`,
        interviewRecordId: studioInterviewSchedule.interviewRecordId,
        status: studioInterviewSchedule.status,
      })
      .from(studioInterviewSchedule)
      .innerJoin(studioInterview, eq(studioInterview.id, studioInterviewSchedule.interviewRecordId))
      .where(
        and(
          eq(studioInterviewSchedule.organizationId, organizationId),
          selectedJobCondition(activityJobIds),
          odcRoleCondition(studioInterviewSchedule.createdByRole, odcRoles),
          ne(studioInterviewSchedule.status, "cancelled"),
          ...instantRangeConditions(studioInterviewSchedule.scheduledAt, futureRange),
        ),
      ),
  ]);

  const byDay = new Map<string, typeof futureRows>(futureDays.map((day) => [day, []]));
  for (const futureRow of futureRows) {
    byDay.get(futureRow.day)?.push(futureRow);
  }
  return {
    future: futureDays.map((day) => ({
      day,
      value: countUniqueAiCandidates(byDay.get(day) ?? []),
    })),
    overall: row?.overall ?? 0,
    today: row?.today ?? 0,
  };
}

async function loadHumanMetrics(
  organizationId: string,
  progressJobIds: string[],
  progressRange: InstantRange,
  activityJobIds: string[],
  activityRange: InstantRange,
  odcRoles: readonly string[],
) {
  const [row] = await db
    .select({
      completed: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioHumanInterviewRound.status, "completed"),
        selectedJobCondition(activityJobIds),
        odcRoleCondition(studioHumanInterviewRound.completedByRole, odcRoles),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, activityRange),
      )})`.mapWith(Number),
      inProgress: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioHumanInterviewRound.status, "pending"),
        isNotNull(studioHumanInterviewRound.startedAt),
        selectedJobCondition(activityJobIds),
        odcRoleCondition(studioHumanInterviewRound.createdByRole, odcRoles),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, activityRange),
      )})`.mapWith(Number),
      overall: sql<number>`COUNT(*) FILTER (WHERE ${and(
        ne(studioHumanInterviewRound.status, "cancelled"),
        selectedJobCondition(progressJobIds),
        odcRoleCondition(studioHumanInterviewRound.createdByRole, odcRoles),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, progressRange),
      )})`.mapWith(Number),
      today: sql<number>`COUNT(*) FILTER (WHERE ${and(
        ne(studioHumanInterviewRound.status, "cancelled"),
        selectedJobCondition(activityJobIds),
        odcRoleCondition(studioHumanInterviewRound.createdByRole, odcRoles),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, activityRange),
      )})`.mapWith(Number),
      upcoming: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioHumanInterviewRound.status, "pending"),
        isNull(studioHumanInterviewRound.startedAt),
        selectedJobCondition(activityJobIds),
        odcRoleCondition(studioHumanInterviewRound.createdByRole, odcRoles),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, activityRange),
      )})`.mapWith(Number),
    })
    .from(studioHumanInterviewRound)
    .innerJoin(studioInterview, eq(studioInterview.id, studioHumanInterviewRound.interviewRecordId))
    .where(eq(studioHumanInterviewRound.organizationId, organizationId));
  return {
    completed: row?.completed ?? 0,
    inProgress: row?.inProgress ?? 0,
    overall: row?.overall ?? 0,
    today: row?.today ?? 0,
    upcoming: row?.upcoming ?? 0,
  };
}

async function loadOfferMetrics(
  organizationId: string,
  progressJobIds: string[],
  progressRange: InstantRange,
  activityJobIds: string[],
  activityRange: InstantRange,
  futureDays: string[],
  odcRoles: readonly string[],
) {
  const [firstSentRows, offerRows] = await Promise.all([
    db
      .select({
        interviewRecordId: studioOfferDraft.interviewRecordId,
        jobDescriptionId: studioInterview.jobDescriptionId,
        role: studioOfferDraft.sentByRole,
        sentAt: studioOfferDraft.sentAt,
      })
      .from(studioOfferDraft)
      .innerJoin(studioInterview, eq(studioInterview.id, studioOfferDraft.interviewRecordId))
      .where(
        and(
          eq(studioOfferDraft.organizationId, organizationId),
          sql`${studioInterview.jobDescriptionId} in (${sql.join(
            [...new Set([...progressJobIds, ...activityJobIds])].map((id) => sql`${id}`),
            sql`, `,
          )})`,
          isNotNull(studioOfferDraft.sentAt),
        ),
      ),
    db
      .select({
        interviewRecordId: studioOfferDraft.interviewRecordId,
        jobDescriptionId: studioInterview.jobDescriptionId,
        joiningDate: studioOfferDraft.joiningDate,
        sentByRole: studioOfferDraft.sentByRole,
        status: studioOfferDraft.status,
        version: studioOfferDraft.version,
      })
      .from(studioOfferDraft)
      .innerJoin(studioInterview, eq(studioInterview.id, studioOfferDraft.interviewRecordId))
      .where(
        and(
          eq(studioOfferDraft.organizationId, organizationId),
          sql`${studioInterview.jobDescriptionId} in (${sql.join(
            [...new Set([...progressJobIds, ...activityJobIds])].map((id) => sql`${id}`),
            sql`, `,
          )})`,
          ne(studioOfferDraft.status, "superseded"),
        ),
      )
      .orderBy(asc(studioOfferDraft.interviewRecordId), desc(studioOfferDraft.version)),
  ]);

  const sentOffers = firstSentRows.map((row) => ({
    ...row,
    sentAt: row.sentAt ? new Date(row.sentAt) : null,
  }));
  const latestOffers = latestOfferByInterview(offerRows);
  const progressJobIdSet = new Set(progressJobIds);
  const activityJobIdSet = new Set(activityJobIds);

  const arrivalByDay = new Map(futureDays.map((day) => [day, 0]));
  let expectedOverall = 0;
  let expectedToday = 0;
  for (const offer of latestOffers.values()) {
    if (
      offer.status !== "accepted" ||
      !offer.joiningDate ||
      !offer.jobDescriptionId ||
      !matchesOdcRole(offer.sentByRole, odcRoles)
    ) {
      continue;
    }
    if (progressJobIdSet.has(offer.jobDescriptionId) && inRange(offer.joiningDate, progressRange)) {
      expectedOverall += 1;
    }
    if (activityJobIdSet.has(offer.jobDescriptionId) && inRange(offer.joiningDate, activityRange)) {
      expectedToday += 1;
    }
    const day = toBeijingDayKey(offer.joiningDate);
    if (activityJobIdSet.has(offer.jobDescriptionId) && arrivalByDay.has(day)) {
      arrivalByDay.set(day, (arrivalByDay.get(day) ?? 0) + 1);
    }
  }

  return {
    arrivals: futureDays.map((day) => ({ day, value: arrivalByDay.get(day) ?? 0 })),
    expectedOverall,
    expectedToday,
    overall: countFirstSentOffers(
      sentOffers.filter(
        (offer) => offer.jobDescriptionId && progressJobIdSet.has(offer.jobDescriptionId),
      ),
      progressRange,
      odcRoles,
    ),
    today: countFirstSentOffers(
      sentOffers.filter(
        (offer) => offer.jobDescriptionId && activityJobIdSet.has(offer.jobDescriptionId),
      ),
      activityRange,
      odcRoles,
    ),
  };
}

function zeroDayCounts(days: string[]): OdcAnalysisDayCount[] {
  return days.map((day) => ({ day, value: 0 }));
}

function summarizeDateRange(values: (string | null)[]): string | null {
  const dates = [...new Set(values.filter(Boolean) as string[])].toSorted();
  if (dates.length === 0) {
    return null;
  }
  return dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} 至 ${dates.at(-1)}`;
}

export async function loadOdcAnalysisData(
  organizationId: string,
  filters: OdcAnalysisFilters,
  now = new Date(),
): Promise<OdcAnalysisData> {
  const [selectedJobs, odcRoles] = await Promise.all([
    loadSelectedJobs(organizationId),
    loadOdcRoleNames(organizationId),
  ]);
  const availableJobIds = new Set(selectedJobs.map((job) => job.id));
  const requestedJobIds = [
    ...filters.progressJobDescriptionIds,
    ...filters.activityJobDescriptionIds,
  ];
  if (requestedJobIds.some((id) => !availableJobIds.has(id))) {
    throw new OdcAnalysisFilterError("筛选岗位不存在或不属于当前工作区。");
  }
  const allJobIds = selectedJobs.map((job) => job.id);
  const progressJobIds =
    filters.progressJobDescriptionIds.length > 0 ? filters.progressJobDescriptionIds : allJobIds;
  const activityJobIds =
    filters.activityJobDescriptionIds.length > 0 ? filters.activityJobDescriptionIds : allJobIds;
  const progressRange = resolveOdcAnalysisRange({
    from: filters.progressFrom,
    to: filters.progressTo,
  });
  const today = toBeijingDayKey(now);
  const activityDay = filters.activityDate ?? today;
  const activityRange = {
    end: beijingDayStart(addCalendarDays(activityDay, 1)),
    start: beijingDayStart(activityDay),
  };
  const futureDays = [1, 2, 3].map((offset) => addCalendarDays(activityDay, offset));
  const futureRange = {
    end: beijingDayStart(addCalendarDays(activityDay, 4)),
    start: beijingDayStart(addCalendarDays(activityDay, 1)),
  };

  const demandDateKey = filters.demandDateField;
  const demandJobs = selectedJobs.filter(
    (job) =>
      (!filters.demandFrom || (job[demandDateKey] && job[demandDateKey] >= filters.demandFrom)) &&
      (!filters.demandTo || (job[demandDateKey] && job[demandDateKey] <= filters.demandTo)),
  );
  const totalHeadcount = demandJobs.reduce((sum, job) => sum + (job.headcount ?? 0), 0);

  if (allJobIds.length === 0) {
    return {
      activity: {
        aiInterviews: metric(0, "candidate"),
        associatedResumes: metric(0, "candidate"),
        currentPendingEvaluation: metric(0, "candidate"),
        expectedArrivals: metric(0, "candidate"),
        humanInterviewRounds: metric(0, "round"),
        newOffers: metric(0, "offer"),
        onboarded: metric(0, "candidate"),
        rejectedOrWithdrawn: metric(0, "candidate", { rejected: 0, withdrawn: 0 }),
      },
      activityInterviewStates: { completed: 0, inProgress: 0, upcoming: 0 },
      demand: {
        connectedJobs: metric(0, "job"),
        expectedOnboardDate: null,
        onboarded: metric(0, "candidate"),
        requestedDate: null,
        totalHeadcount: metric(0, "headcount"),
        vacancies: metric(0, "headcount"),
      },
      filters,
      generatedAt: now.toISOString(),
      overall: {
        aiInterviews: metric(0, "candidate"),
        associatedResumes: metric(0, "candidate"),
        currentPendingEvaluation: metric(0, "candidate"),
        expectedArrivals: metric(0, "candidate"),
        humanInterviewRounds: metric(0, "round"),
        offers: metric(0, "offer"),
        onboarded: metric(0, "candidate"),
        rejectedOrWithdrawn: metric(0, "candidate", { rejected: 0, withdrawn: 0 }),
      },
      timeZone: "Asia/Shanghai",
      upcoming: { aiInterviews: zeroDayCounts(futureDays), arrivals: zeroDayCounts(futureDays) },
    };
  }

  const demandJobIds = demandJobs.map((job) => job.id);
  const [candidate, ai, human, offer, demandOnboarded] = await Promise.all([
    loadCandidateMetrics(
      organizationId,
      progressJobIds,
      progressRange,
      activityJobIds,
      activityRange,
      odcRoles,
    ),
    loadAiMetrics(
      organizationId,
      progressJobIds,
      progressRange,
      activityJobIds,
      activityRange,
      futureRange,
      futureDays,
      odcRoles,
    ),
    loadHumanMetrics(
      organizationId,
      progressJobIds,
      progressRange,
      activityJobIds,
      activityRange,
      odcRoles,
    ),
    loadOfferMetrics(
      organizationId,
      progressJobIds,
      progressRange,
      activityJobIds,
      activityRange,
      futureDays,
      odcRoles,
    ),
    loadDemandOnboarded(organizationId, demandJobIds, odcRoles),
  ]);

  const vacancies = Math.max(totalHeadcount - demandOnboarded, 0);

  return {
    activity: {
      aiInterviews: metric(ai.today, "candidate"),
      associatedResumes: metric(candidate.todayAssociated, "candidate"),
      currentPendingEvaluation: metric(candidate.todayPendingEvaluation, "candidate"),
      expectedArrivals: metric(offer.expectedToday, "candidate"),
      humanInterviewRounds: metric(human.today, "round"),
      newOffers: metric(offer.today, "offer"),
      onboarded: metric(candidate.todayOnboarded, "candidate"),
      rejectedOrWithdrawn: metric(candidate.todayRejected + candidate.todayWithdrawn, "candidate", {
        rejected: candidate.todayRejected,
        withdrawn: candidate.todayWithdrawn,
      }),
    },
    activityInterviewStates: {
      completed: human.completed,
      inProgress: human.inProgress,
      upcoming: human.upcoming,
    },
    demand: {
      connectedJobs: metric(demandJobs.length, "job"),
      expectedOnboardDate: summarizeDateRange(demandJobs.map((job) => job.expectedOnboardDate)),
      onboarded: metric(demandOnboarded, "candidate"),
      requestedDate: summarizeDateRange(demandJobs.map((job) => job.requestedDate)),
      totalHeadcount: metric(totalHeadcount, "headcount"),
      vacancies: metric(vacancies, "headcount"),
    },
    filters,
    generatedAt: now.toISOString(),
    overall: {
      aiInterviews: metric(ai.overall, "candidate"),
      associatedResumes: metric(candidate.associated, "candidate"),
      currentPendingEvaluation: metric(candidate.pendingEvaluation, "candidate"),
      expectedArrivals: metric(offer.expectedOverall, "candidate"),
      humanInterviewRounds: metric(human.overall, "round"),
      offers: metric(offer.overall, "offer"),
      onboarded: metric(candidate.onboarded, "candidate"),
      rejectedOrWithdrawn: metric(candidate.rejected + candidate.withdrawn, "candidate", {
        rejected: candidate.rejected,
        withdrawn: candidate.withdrawn,
      }),
    },
    timeZone: "Asia/Shanghai",
    upcoming: { aiInterviews: ai.future, arrivals: offer.arrivals },
  };
}

export async function loadOdcAnalysis(
  organizationId: string,
  filters: OdcAnalysisFilters,
): Promise<{
  data: OdcAnalysisData;
  jobs: OdcAnalysisJobOption[];
}> {
  const [data, jobs] = await Promise.all([
    loadOdcAnalysisData(organizationId, filters),
    loadOdcAnalysisJobOptions(organizationId),
  ]);
  return { data, jobs };
}
