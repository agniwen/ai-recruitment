import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  interviewAuditLog,
  jobDescription,
  member,
  organizationRole,
  studioHumanInterviewRound,
  studioInterview,
  studioInterviewSchedule,
  studioOfferDraft,
} from "@arc/db-schema/schema";
import { ODC_ANALYSIS_UNKNOWN_ROLE } from "@arc/shared/odc-analysis";
import type {
  OdcAnalysisData,
  OdcAnalysisDayCount,
  OdcAnalysisFilters,
  OdcAnalysisJobOption,
  OdcAnalysisMetric,
  OdcAnalysisRoleOption,
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
import { matchesSelectedRole, roleCondition } from "./utils/role-filter";

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

function loadSelectedJobs(organizationId: string, filters: OdcAnalysisFilters) {
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
    .where(
      and(
        eq(jobDescription.organizationId, organizationId),
        filters.jobDescriptionIds.length > 0
          ? inArray(jobDescription.id, filters.jobDescriptionIds)
          : undefined,
      ),
    )
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

const BUILT_IN_ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  member: "普通成员",
  noAccess: "空权限用户",
  owner: "拥有者",
};

export async function loadOdcAnalysisRoleOptions(
  organizationId: string,
  selectedRole?: string,
): Promise<OdcAnalysisRoleOption[]> {
  const [dynamicRoles, ...roleRows] = await Promise.all([
    db
      .select({ label: organizationRole.name, value: organizationRole.role })
      .from(organizationRole)
      .where(eq(organizationRole.organizationId, organizationId)),
    db
      .selectDistinct({ value: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId)),
    db
      .selectDistinct({ value: studioInterview.createdByRole })
      .from(studioInterview)
      .where(eq(studioInterview.organizationId, organizationId)),
    db
      .selectDistinct({ value: studioInterview.onboardedConfirmedByRole })
      .from(studioInterview)
      .where(eq(studioInterview.organizationId, organizationId)),
    db
      .selectDistinct({ value: studioInterviewSchedule.createdByRole })
      .from(studioInterviewSchedule)
      .where(eq(studioInterviewSchedule.organizationId, organizationId)),
    db
      .selectDistinct({ value: studioHumanInterviewRound.createdByRole })
      .from(studioHumanInterviewRound)
      .where(eq(studioHumanInterviewRound.organizationId, organizationId)),
    db
      .selectDistinct({ value: studioHumanInterviewRound.completedByRole })
      .from(studioHumanInterviewRound)
      .where(eq(studioHumanInterviewRound.organizationId, organizationId)),
    db
      .selectDistinct({ value: studioOfferDraft.sentByRole })
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.organizationId, organizationId)),
    db
      .selectDistinct({ value: interviewAuditLog.operatorRole })
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.organizationId, organizationId)),
  ]);
  const labels = new Map(dynamicRoles.map((role) => [role.value, role.label]));
  for (const row of roleRows.flat()) {
    if (row.value) {
      labels.set(row.value, labels.get(row.value) ?? BUILT_IN_ROLE_LABELS[row.value] ?? row.value);
    }
  }
  if (selectedRole && selectedRole !== ODC_ANALYSIS_UNKNOWN_ROLE && !labels.has(selectedRole)) {
    labels.set(selectedRole, BUILT_IN_ROLE_LABELS[selectedRole] ?? selectedRole);
  }
  return [
    ...[...labels]
      .map(([value, label]) => ({ label, value }))
      .toSorted((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    { label: "历史角色未知", value: ODC_ANALYSIS_UNKNOWN_ROLE },
  ];
}

function latestTransitionRoleCondition(selectedRole?: string) {
  if (!selectedRole) {
    return;
  }
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
  return roleCondition(latestRole, selectedRole);
}

// oxlint-disable-next-line complexity -- A single aggregate query intentionally keeps all dashboard counters on one snapshot.
async function loadCandidateMetrics(
  organizationId: string,
  jobIds: string[],
  range: InstantRange,
  todayRange: InstantRange,
  selectedRole?: string,
) {
  const [row] = await db
    .select({
      associated: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.resumeParseStatus, "ready"),
        timestampCondition(studioInterview.createdAt, range),
        roleCondition(studioInterview.createdByRole, selectedRole),
      )})`.mapWith(Number),
      onboarded: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "hired"),
        isNotNull(studioInterview.actualOnboardedAt),
        roleCondition(studioInterview.onboardedConfirmedByRole, selectedRole),
        ...instantRangeConditions(studioInterview.actualOnboardedAt, range),
      )})`.mapWith(Number),
      pendingEvaluation: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.pipelineStage, CURRENT_PENDING_EVALUATION_FACT.pipelineStage),
        eq(studioInterview.outcome, CURRENT_PENDING_EVALUATION_FACT.outcome),
        eq(studioInterview.resumeParseStatus, "ready"),
        isNull(studioInterview.resumeEvaluationStatus),
        roleCondition(studioInterview.createdByRole, selectedRole),
        ...instantRangeConditions(studioInterview.createdAt, range),
      )})`.mapWith(Number),
      rejected: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "rejected"),
        latestTransitionRoleCondition(selectedRole),
        ...instantRangeConditions(studioInterview.closedAt, range),
      )})`.mapWith(Number),
      todayAssociated: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.resumeParseStatus, "ready"),
        timestampCondition(studioInterview.createdAt, todayRange),
        roleCondition(studioInterview.createdByRole, selectedRole),
      )})`.mapWith(Number),
      todayOnboarded: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "hired"),
        isNotNull(studioInterview.actualOnboardedAt),
        roleCondition(studioInterview.onboardedConfirmedByRole, selectedRole),
        ...instantRangeConditions(studioInterview.actualOnboardedAt, todayRange),
      )})`.mapWith(Number),
      todayPendingEvaluation: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.pipelineStage, CURRENT_PENDING_EVALUATION_FACT.pipelineStage),
        eq(studioInterview.outcome, CURRENT_PENDING_EVALUATION_FACT.outcome),
        eq(studioInterview.resumeParseStatus, "ready"),
        isNull(studioInterview.resumeEvaluationStatus),
        roleCondition(studioInterview.createdByRole, selectedRole),
        ...instantRangeConditions(studioInterview.createdAt, todayRange),
      )})`.mapWith(Number),
      todayRejected: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "rejected"),
        latestTransitionRoleCondition(selectedRole),
        ...instantRangeConditions(studioInterview.closedAt, todayRange),
      )})`.mapWith(Number),
      todayWithdrawn: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "withdrawn"),
        latestTransitionRoleCondition(selectedRole),
        ...instantRangeConditions(studioInterview.closedAt, todayRange),
      )})`.mapWith(Number),
      withdrawn: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioInterview.outcome, "withdrawn"),
        latestTransitionRoleCondition(selectedRole),
        ...instantRangeConditions(studioInterview.closedAt, range),
      )})`.mapWith(Number),
    })
    .from(studioInterview)
    .where(and(eq(studioInterview.organizationId, organizationId), selectedJobCondition(jobIds)));

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

async function loadDemandOnboarded(organizationId: string, jobIds: string[]): Promise<number> {
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
      ),
    );
  return row?.value ?? 0;
}

async function loadAiMetrics(
  organizationId: string,
  jobIds: string[],
  range: InstantRange,
  todayRange: InstantRange,
  futureRange: InstantRange,
  futureDays: string[],
  selectedRole?: string,
) {
  const [[row], futureRows] = await Promise.all([
    db
      .select({
        overall:
          sql<number>`COUNT(DISTINCT ${studioInterviewSchedule.interviewRecordId}) FILTER (WHERE ${and(
            ne(studioInterviewSchedule.status, "cancelled"),
            ...instantRangeConditions(studioInterviewSchedule.scheduledAt, range),
          )})`.mapWith(Number),
        today:
          sql<number>`COUNT(DISTINCT ${studioInterviewSchedule.interviewRecordId}) FILTER (WHERE ${and(
            ne(studioInterviewSchedule.status, "cancelled"),
            ...instantRangeConditions(studioInterviewSchedule.scheduledAt, todayRange),
          )})`.mapWith(Number),
      })
      .from(studioInterviewSchedule)
      .innerJoin(studioInterview, eq(studioInterview.id, studioInterviewSchedule.interviewRecordId))
      .where(
        and(
          eq(studioInterviewSchedule.organizationId, organizationId),
          selectedJobCondition(jobIds),
          roleCondition(studioInterviewSchedule.createdByRole, selectedRole),
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
          selectedJobCondition(jobIds),
          roleCondition(studioInterviewSchedule.createdByRole, selectedRole),
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
  jobIds: string[],
  range: InstantRange,
  todayRange: InstantRange,
  selectedRole?: string,
) {
  const [row] = await db
    .select({
      completed: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioHumanInterviewRound.status, "completed"),
        roleCondition(studioHumanInterviewRound.completedByRole, selectedRole),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, todayRange),
      )})`.mapWith(Number),
      inProgress: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioHumanInterviewRound.status, "pending"),
        isNotNull(studioHumanInterviewRound.startedAt),
        roleCondition(studioHumanInterviewRound.createdByRole, selectedRole),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, todayRange),
      )})`.mapWith(Number),
      overall: sql<number>`COUNT(*) FILTER (WHERE ${and(
        ne(studioHumanInterviewRound.status, "cancelled"),
        roleCondition(studioHumanInterviewRound.createdByRole, selectedRole),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, range),
      )})`.mapWith(Number),
      today: sql<number>`COUNT(*) FILTER (WHERE ${and(
        ne(studioHumanInterviewRound.status, "cancelled"),
        roleCondition(studioHumanInterviewRound.createdByRole, selectedRole),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, todayRange),
      )})`.mapWith(Number),
      upcoming: sql<number>`COUNT(*) FILTER (WHERE ${and(
        eq(studioHumanInterviewRound.status, "pending"),
        isNull(studioHumanInterviewRound.startedAt),
        roleCondition(studioHumanInterviewRound.createdByRole, selectedRole),
        ...instantRangeConditions(studioHumanInterviewRound.scheduledAt, todayRange),
      )})`.mapWith(Number),
    })
    .from(studioHumanInterviewRound)
    .innerJoin(studioInterview, eq(studioInterview.id, studioHumanInterviewRound.interviewRecordId))
    .where(
      and(
        eq(studioHumanInterviewRound.organizationId, organizationId),
        selectedJobCondition(jobIds),
      ),
    );
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
  jobIds: string[],
  range: InstantRange,
  todayRange: InstantRange,
  futureDays: string[],
  selectedRole?: string,
) {
  const [firstSentRows, offerRows] = await Promise.all([
    db
      .select({
        interviewRecordId: studioOfferDraft.interviewRecordId,
        role: studioOfferDraft.sentByRole,
        sentAt: studioOfferDraft.sentAt,
      })
      .from(studioOfferDraft)
      .innerJoin(studioInterview, eq(studioInterview.id, studioOfferDraft.interviewRecordId))
      .where(
        and(
          eq(studioOfferDraft.organizationId, organizationId),
          selectedJobCondition(jobIds),
          isNotNull(studioOfferDraft.sentAt),
        ),
      ),
    db
      .select({
        interviewRecordId: studioOfferDraft.interviewRecordId,
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
          selectedJobCondition(jobIds),
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

  const arrivalByDay = new Map(futureDays.map((day) => [day, 0]));
  let expectedOverall = 0;
  let expectedToday = 0;
  for (const offer of latestOffers.values()) {
    if (
      offer.status !== "accepted" ||
      !offer.joiningDate ||
      !matchesSelectedRole(offer.sentByRole, selectedRole)
    ) {
      continue;
    }
    if (inRange(offer.joiningDate, range)) {
      expectedOverall += 1;
    }
    if (inRange(offer.joiningDate, todayRange)) {
      expectedToday += 1;
    }
    const day = toBeijingDayKey(offer.joiningDate);
    if (arrivalByDay.has(day)) {
      arrivalByDay.set(day, (arrivalByDay.get(day) ?? 0) + 1);
    }
  }

  return {
    arrivals: futureDays.map((day) => ({ day, value: arrivalByDay.get(day) ?? 0 })),
    expectedOverall,
    expectedToday,
    overall: countFirstSentOffers(sentOffers, range, selectedRole),
    today: countFirstSentOffers(sentOffers, todayRange, selectedRole),
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
  const selectedJobs = await loadSelectedJobs(organizationId, filters);
  if (
    filters.jobDescriptionIds.length > 0 &&
    selectedJobs.length !== filters.jobDescriptionIds.length
  ) {
    throw new OdcAnalysisFilterError("筛选岗位不存在或不属于当前工作区。");
  }
  const jobIds = selectedJobs.map((job) => job.id);
  const range = resolveOdcAnalysisRange(filters);
  const today = toBeijingDayKey(now);
  const todayRange = {
    end: beijingDayStart(addCalendarDays(today, 1)),
    start: beijingDayStart(today),
  };
  const futureDays = [1, 2, 3].map((offset) => addCalendarDays(today, offset));
  const futureRange = {
    end: beijingDayStart(addCalendarDays(today, 4)),
    start: beijingDayStart(addCalendarDays(today, 1)),
  };

  const demandJobs = selectedJobs.filter(
    (job) =>
      (!filters.from || (job.requestedDate && job.requestedDate >= filters.from)) &&
      (!filters.to || (job.requestedDate && job.requestedDate <= filters.to)),
  );
  const totalHeadcount = demandJobs.reduce((sum, job) => sum + (job.headcount ?? 0), 0);

  if (jobIds.length === 0) {
    return {
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
      today: {
        aiInterviews: metric(0, "candidate"),
        associatedResumes: metric(0, "candidate"),
        currentPendingEvaluation: metric(0, "candidate"),
        expectedArrivals: metric(0, "candidate"),
        humanInterviewRounds: metric(0, "round"),
        newOffers: metric(0, "offer"),
        onboarded: metric(0, "candidate"),
        rejectedOrWithdrawn: metric(0, "candidate", { rejected: 0, withdrawn: 0 }),
      },
      todayInterviewStates: { completed: 0, inProgress: 0, upcoming: 0 },
      upcoming: { aiInterviews: zeroDayCounts(futureDays), arrivals: zeroDayCounts(futureDays) },
    };
  }

  const demandJobIds = demandJobs.map((job) => job.id);
  const [candidate, ai, human, offer, demandOnboarded] = await Promise.all([
    loadCandidateMetrics(organizationId, jobIds, range, todayRange, filters.role),
    loadAiMetrics(organizationId, jobIds, range, todayRange, futureRange, futureDays, filters.role),
    loadHumanMetrics(organizationId, jobIds, range, todayRange, filters.role),
    loadOfferMetrics(organizationId, jobIds, range, todayRange, futureDays, filters.role),
    loadDemandOnboarded(organizationId, demandJobIds),
  ]);

  const vacancies = Math.max(totalHeadcount - demandOnboarded, 0);

  return {
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
    today: {
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
    todayInterviewStates: {
      completed: human.completed,
      inProgress: human.inProgress,
      upcoming: human.upcoming,
    },
    upcoming: { aiInterviews: ai.future, arrivals: offer.arrivals },
  };
}

export async function loadOdcAnalysis(
  organizationId: string,
  filters: OdcAnalysisFilters,
): Promise<{
  data: OdcAnalysisData;
  jobs: OdcAnalysisJobOption[];
  roles: OdcAnalysisRoleOption[];
}> {
  const [data, jobs, roles] = await Promise.all([
    loadOdcAnalysisData(organizationId, filters),
    loadOdcAnalysisJobOptions(organizationId),
    loadOdcAnalysisRoleOptions(organizationId, filters.role),
  ]);
  return { data, jobs, roles };
}
