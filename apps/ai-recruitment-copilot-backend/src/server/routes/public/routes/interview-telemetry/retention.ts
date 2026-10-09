import { sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";

export function pruneInterviewTelemetry() {
  const configured = Number(process.env.INTERVIEW_TELEMETRY_RETENTION_DAYS ?? 90);
  const days =
    Number.isInteger(configured) && configured >= 7 && configured <= 365 ? configured : 90;
  // Bounded batches avoid a long delete transaction on the interview database.
  return db.execute(sql`
    delete from interview_telemetry_event where id in (
      select id from interview_telemetry_event
      where received_at < now() - make_interval(days => ${days})
      order by received_at limit 10000
    )
  `);
}
