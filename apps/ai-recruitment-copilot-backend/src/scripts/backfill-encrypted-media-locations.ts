import { pathToFileURL } from "node:url";
import { and, count, eq, gt, isNotNull, isNull, notLike, or, sql } from "drizzle-orm";
import { interviewMediaAsset as asset, interviewMediaRoom as archive } from "@arc/db-schema/schema";
import type { Database } from "../lib/server/db";
import { loadStandaloneEnv } from "../standalone/env";
import {
  MEDIA_LOCATION_PREFIX,
  decryptMediaStorageKey,
  encryptMediaStorageKey,
} from "../server/routes/platform/routes/interview-logs/routes/media/encryption";

const roomMatch = and(eq(archive.roomSid, asset.roomSid), eq(archive.meetingId, asset.meetingId));
const plaintext = and(
  isNotNull(asset.storageKey),
  notLike(asset.storageKey, `${MEDIA_LOCATION_PREFIX}%`),
);

async function inspectLocations(db: Database) {
  const [[remaining], [unreadable], [invalid]] = await Promise.all([
    db.select({ count: count() }).from(asset).where(plaintext),
    db
      .select({ count: count() })
      .from(asset)
      .leftJoin(archive, roomMatch)
      .where(
        and(
          isNotNull(asset.storageKey),
          or(isNull(archive.organizationId), isNull(asset.storageBackend)),
        ),
      ),
    db
      .select({ count: count() })
      .from(asset)
      .where(
        and(
          plaintext,
          sql`${asset.storageKey} !~ '^human-interview-samples/[a-f0-9-]+[.](jpg|wav)$'`,
        ),
      ),
  ]);
  return {
    invalidLocations: invalid.count,
    remainingPlaintext: remaining.count,
    unreadableReferences: unreadable.count,
  };
}

function locationRows(db: Database) {
  return db
    .select({
      id: asset.id,
      meetingId: asset.meetingId,
      organizationId: archive.organizationId,
      storageBackend: asset.storageBackend,
      storageKey: asset.storageKey,
    })
    .from(asset)
    .innerJoin(archive, roomMatch);
}

export async function backfillEncryptedMediaLocations(db: Database, apply = false) {
  const before = await inspectLocations(db);
  if (!apply) {
    return before;
  }
  if (before.unreadableReferences || before.invalidLocations) {
    throw new Error("Media location migration requires valid archive references and storage keys");
  }
  // Validate configuration, including literal env-file quotes, before the first write.
  await encryptMediaStorageKey("human-interview-samples/00000000-0000-0000-0000-000000000000.jpg", {
    id: "configuration-check",
    meetingId: "configuration-check",
    organizationId: "configuration-check",
    storageBackend: "r2",
  });
  for (;;) {
    const rows = await locationRows(db).where(plaintext).orderBy(asset.id).limit(200);
    if (!rows.length) {
      break;
    }
    for (const row of rows) {
      if (!row.storageKey || !row.storageBackend) {
        throw new Error("Media location reference changed during migration");
      }
      const encrypted = await encryptMediaStorageKey(row.storageKey, {
        id: row.id,
        meetingId: row.meetingId,
        organizationId: row.organizationId,
        storageBackend: row.storageBackend,
      });
      await db
        .update(asset)
        .set({ storageKey: encrypted })
        .where(and(eq(asset.id, row.id), eq(asset.storageKey, row.storageKey)));
    }
  }
  const after = await inspectLocations(db);
  if (Object.values(after).some((value) => value !== 0)) {
    throw new Error("Media location migration incomplete");
  }
  return after;
}

export async function verifyEncryptedMediaLocations(db: Database) {
  const state = await inspectLocations(db);
  if (Object.values(state).some((value) => value !== 0)) {
    throw new Error("Media locations require migration before verification");
  }
  let cursor = "";
  let verified = 0;
  for (;;) {
    const rows = await locationRows(db)
      .where(and(isNotNull(asset.storageKey), gt(asset.id, cursor)))
      .orderBy(asset.id)
      .limit(200);
    if (!rows.length) {
      break;
    }
    for (const row of rows) {
      if (!row.storageKey || !row.storageBackend) {
        throw new Error("Media location reference changed during verification");
      }
      await decryptMediaStorageKey(row.storageKey, {
        id: row.id,
        meetingId: row.meetingId,
        organizationId: row.organizationId,
        storageBackend: row.storageBackend,
      });
      verified += 1;
      cursor = row.id;
    }
  }
  return { verified };
}

async function main() {
  loadStandaloneEnv();
  const { db, closeDatabase } = await import("../lib/server/db");
  try {
    const counts = await backfillEncryptedMediaLocations(db, process.argv.includes("--apply"));
    const verification = process.argv.includes("--verify")
      ? await verifyEncryptedMediaLocations(db)
      : undefined;
    console.log({ ...counts, ...verification });
  } catch {
    console.error(
      "Media location migration failed. Check configuration and archive references; no storage values were logged.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
