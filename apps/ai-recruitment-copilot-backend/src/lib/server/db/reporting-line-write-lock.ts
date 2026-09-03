import { sql } from "drizzle-orm";
import type { db } from ".";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function acquireReportingLineWriteLock(
  tx: DatabaseTransaction,
  organizationId: string,
): Promise<void> {
  const lockKey = `member_reporting_line:${organizationId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}
