import { pathToFileURL } from "node:url";
import { and, count, eq, isNotNull, notLike, sql } from "drizzle-orm";
import {
  candidateEntryCredentialUse as uses,
  interviewMediaAsset as asset,
  interviewMediaRoom as room,
  interviewTelemetryEvent as events,
  session,
} from "@arc/db-schema/schema";
import type { Database } from "../lib/server/db";
import { encryptIp, ipContext, ipLookupHash, sessionIpContext } from "../lib/server/ip-encryption";
import { loadStandaloneEnv } from "../standalone/env";

export async function backfillEncryptedIps(
  db: Database,
  apply = false,
): Promise<{ entryUses: number; mediaSnapshots: number; sessions: number; telemetry: number }> {
  const rawEvent = and(isNotNull(events.ip), notLike(events.ip, "ip:v1:%"));
  const rawUse = and(isNotNull(uses.ip), notLike(uses.ip, "ip:v1:%"));
  const rawMedia = sql`${asset.environment}->>'ip' is not null and ${asset.environment}->>'ip' not like 'ip:v1:%'`;
  const [[eventCount], [useCount], [mediaCount], [sessionCount]] = await Promise.all([
    db.select({ count: count() }).from(events).where(rawEvent),
    db.select({ count: count() }).from(uses).where(rawUse),
    db.select({ count: count() }).from(asset).where(rawMedia),
    db.select({ count: count() }).from(session).where(isNotNull(session.ipAddress)),
  ]);
  const before = {
    entryUses: useCount.count,
    mediaSnapshots: mediaCount.count,
    sessions: sessionCount.count,
    telemetry: eventCount.count,
  };
  if (!apply) {
    return before;
  }

  // Validate required write keys before changing the first row. No fallback to plaintext.
  await encryptIp("192.0.2.1", ipContext("migration-check", "check", "check"));
  ipLookupHash("192.0.2.1");
  for (const table of [events, uses]) {
    for (;;) {
      const rows = await db
        .select({ id: table.id, ip: table.ip, organizationId: table.organizationId })
        .from(table)
        .where(and(isNotNull(table.ip), notLike(table.ip, "ip:v1:%")))
        .orderBy(table.id)
        .limit(200);
      if (!rows.length) {
        break;
      }
      for (const row of rows) {
        if (row.ip === null) {
          continue;
        }
        const kind = table === events ? "telemetry" : "entry-use";
        const ip = await encryptIp(row.ip, ipContext(kind, row.organizationId, row.id));
        const where = and(eq(table.id, row.id), eq(table.ip, row.ip));
        await (table === events
          ? db
              .update(events)
              .set({ ip, ipLookupHash: row.ip ? ipLookupHash(row.ip) : null })
              .where(where)
          : db.update(uses).set({ ip }).where(where));
      }
    }
  }
  for (;;) {
    const rows = await db
      .select()
      .from(session)
      .where(isNotNull(session.ipAddress))
      .orderBy(session.id)
      .limit(200);
    if (!rows.length) {
      break;
    }
    for (const row of rows) {
      if (row.ipAddress === null) {
        continue;
      }
      await db
        .update(session)
        .set({
          ipAddress: null,
          ipCiphertext: await encryptIp(row.ipAddress, sessionIpContext(row.userId, row.token)),
        })
        .where(and(eq(session.id, row.id), eq(session.ipAddress, row.ipAddress)));
    }
  }
  for (;;) {
    const rows = await db
      .select({ environment: asset.environment, id: asset.id, organizationId: room.organizationId })
      .from(asset)
      .innerJoin(room, eq(room.roomSid, asset.roomSid))
      .where(rawMedia)
      .orderBy(asset.id)
      .limit(200);
    if (!rows.length) {
      break;
    }
    for (const row of rows) {
      const ip = await encryptIp(
        row.environment.ip,
        ipContext("media", row.organizationId, row.id),
      );
      const environment = { ...row.environment, ip: ip ?? undefined };
      await db
        .update(asset)
        .set({ environment })
        .where(and(eq(asset.id, row.id), sql`${asset.environment}->>'ip' = ${row.environment.ip}`));
    }
  }
  const after = await backfillEncryptedIps(db, false);
  if (Object.values(after).some((value) => value !== 0)) {
    throw new Error("IP migration incomplete; check orphaned media archives");
  }
  return after;
}

async function main() {
  loadStandaloneEnv();
  const { db, closeDatabase } = await import("../lib/server/db");
  try {
    console.log({
      apply: process.argv.includes("--apply"),
      remainingPlaintext: await backfillEncryptedIps(db, process.argv.includes("--apply")),
    });
  } catch {
    // Driver errors may contain SQL parameters. Operators should inspect counts, never raw query logs.
    console.error(
      "IP migration failed. Check security configuration and data validity; no values were logged.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
