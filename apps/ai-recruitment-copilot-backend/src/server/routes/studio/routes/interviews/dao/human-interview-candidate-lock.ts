import { and, eq, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  hiringUnit,
  organization,
  studioHumanInterviewRound,
  studioInterview,
} from "@arc/db-schema/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function candidateIdentityCondition(candidate: {
  email: string | null;
  hash: string | null;
  phone: string | null;
  poolItemId: string | null;
}) {
  const email = candidate.email?.trim().toLowerCase();
  const phone = candidate.phone?.replaceAll(/[\s()+-]/g, "");
  return or(
    candidate.poolItemId
      ? eq(studioInterview.resumeSourcePoolItemId, candidate.poolItemId)
      : undefined,
    candidate.hash ? eq(studioInterview.resumeContentHash, candidate.hash) : undefined,
    email ? sql`lower(trim(${studioInterview.candidateEmail})) = ${email}` : undefined,
    phone
      ? sql`regexp_replace(${studioInterview.candidatePhone}, '[[:space:]()+-]', '', 'g') = ${phone}`
      : undefined,
  );
}

// A workspace row serializes scheduling writes, including different records of the same person.
// Always acquire this before locking a round to keep a consistent lock order.
export async function lockHumanInterviewScheduling(tx: Tx, organizationId: string) {
  await tx
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .for("update");
}

export async function findHumanInterviewCandidateLock({
  interviewRecordId,
  organizationId,
  executor = db,
  now = new Date(),
}: {
  interviewRecordId: string;
  organizationId: string;
  executor?: Pick<Tx, "select">;
  now?: Date;
}) {
  const [candidate] = await executor
    .select({
      email: studioInterview.candidateEmail,
      hash: studioInterview.resumeContentHash,
      hiringUnitId: studioInterview.hiringUnitId,
      phone: studioInterview.candidatePhone,
      poolItemId: studioInterview.resumeSourcePoolItemId,
    })
    .from(studioInterview)
    .where(
      and(
        eq(studioInterview.id, interviewRecordId),
        eq(studioInterview.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!candidate) {
    throw new HTTPException(404, {
      res: Response.json({ error: "候选人记录不存在。" }, { status: 404 }),
    });
  }
  if (!candidate.hiringUnitId) {
    return null;
  }

  const identity = candidateIdentityCondition(candidate);
  // Names alone are not a person identifier. Missing identifiers never match unrelated people.
  if (!identity) {
    return null;
  }

  const rounds = await executor
    .select({
      createdAt: studioHumanInterviewRound.createdAt,
      hiringUnitName: hiringUnit.name,
      lockHours: studioHumanInterviewRound.lockHours,
    })
    .from(studioHumanInterviewRound)
    .innerJoin(studioInterview, eq(studioHumanInterviewRound.interviewRecordId, studioInterview.id))
    .innerJoin(hiringUnit, eq(studioInterview.hiringUnitId, hiringUnit.id))
    .where(
      and(
        eq(studioInterview.organizationId, organizationId),
        eq(studioHumanInterviewRound.organizationId, organizationId),
        ne(studioInterview.hiringUnitId, candidate.hiringUnitId),
        eq(studioHumanInterviewRound.status, "pending"),
        identity,
      ),
    );

  let lock: { hiringUnitName: string; unlockAt: string; message: string } | null = null;
  for (const round of rounds) {
    const unlockAt = round.createdAt.getTime() + round.lockHours * 3_600_000;
    if (unlockAt <= now.getTime() || (lock && unlockAt <= new Date(lock.unlockAt).getTime())) {
      continue;
    }
    const remainingHours = Math.ceil((unlockAt - now.getTime()) / 360_000) / 10;
    lock = {
      hiringUnitName: round.hiringUnitName,
      message: `该候选人已被${round.hiringUnitName}约面，还需等待${remainingHours}小时，或等待${round.hiringUnitName}完成面试点评或取消该面试后才能约面。`,
      unlockAt: new Date(unlockAt).toISOString(),
    };
  }
  return lock;
}

export async function assertHumanInterviewCandidateUnlocked(
  executor: Pick<Tx, "select">,
  interviewRecordId: string,
  organizationId: string,
) {
  const lock = await findHumanInterviewCandidateLock({
    executor,
    interviewRecordId,
    organizationId,
  });
  if (lock) {
    throw new HTTPException(409, { res: Response.json({ error: lock.message }, { status: 409 }) });
  }
}
