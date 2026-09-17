import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { parseDatabaseTimestamp } from "@arc/ai-recruitment-copilot-backend/lib/server/db/timestamp-codecs";
import { studioHumanInterviewMeeting, studioHumanInterviewRound } from "@arc/db-schema/schema";

// Legacy timestamp columns contain UTC without an offset; newer columns are
// timestamptz. Normalize before mixing them, independent of the session timezone.
export function calendarTimestamp(column: SQLWrapper) {
  return sql`(case when pg_typeof(${column}) = 'timestamp without time zone'::regtype
    then ${column} at time zone 'UTC' else ${column} end)`;
}

function decodeCalendarTimestamp(value: string | Date): Date {
  return value instanceof Date ? value : parseDatabaseTimestamp(value);
}

export const humanStartAt = sql`coalesce(
  ${calendarTimestamp(studioHumanInterviewMeeting.startedAt)},
  ${calendarTimestamp(studioHumanInterviewRound.scheduledAt)}
)`.mapWith(decodeCalendarTimestamp);
const humanActualEndAt = calendarTimestamp(studioHumanInterviewMeeting.endedAt);
const humanValidUntil = calendarTimestamp(studioHumanInterviewMeeting.validUntil);
export const humanEndAt = sql`case
  when ${humanActualEndAt} > ${humanStartAt} then ${humanActualEndAt}
  when ${humanValidUntil} > ${humanStartAt} then ${humanValidUntil}
  else ${humanStartAt} + interval '1 hour'
end`.mapWith(decodeCalendarTimestamp);
