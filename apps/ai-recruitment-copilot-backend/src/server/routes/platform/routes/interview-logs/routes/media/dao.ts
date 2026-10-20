import { randomUUID } from "node:crypto";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  interviewMediaRoom as archive,
  interviewMediaAsset as asset,
  interviewMediaAccess as access,
} from "@arc/db-schema/schema";
import { readMedia, removeMedia } from "./storage";
import { hideStoredIp } from "@arc/ai-recruitment-copilot-backend/lib/server/ip-encryption";
import { decryptMediaStorageKey } from "./encryption";

export async function listMediaArchives({ page, search }: { page: number; search?: string }) {
  const where = search
    ? or(ilike(archive.meetingTitle, `%${search}%`), ilike(archive.meetingId, `%${search}%`))
    : undefined;
  const [records, [total]] = await Promise.all([
    db
      .select()
      .from(archive)
      .where(where)
      .orderBy(desc(archive.startedAt), archive.roomSid)
      .limit(20)
      .offset((page - 1) * 20),
    db.select({ count: count() }).from(archive).where(where),
  ]);
  return {
    page,
    pageSize: 20,
    records: records.map(({ leaseOwner: _owner, leaseUntil: _until, ...r }) => ({
      ...r,
      endedAt: r.endedAt?.toISOString() ?? null,
      heartbeatAt: r.heartbeatAt?.toISOString() ?? null,
      startedAt: r.startedAt.toISOString(),
    })),
    total: total.count,
  };
}
export async function loadMeetingMedia(
  meetingId: string,
  {
    page,
    kind,
    status,
  }: { page: number; kind?: "audio" | "image"; status?: "ready" | "issues" | "all" },
) {
  let stateCondition = status === "all" ? undefined : eq(asset.status, "ready");
  if (status === "issues") {
    stateCondition = sql`${asset.status} in ('failed', 'skipped', 'pending')`;
  }
  const where = and(
    eq(asset.meetingId, meetingId),
    kind ? eq(asset.kind, kind) : undefined,
    stateCondition,
  );
  const [records, [total], rooms, counts] = await Promise.all([
    db
      .select()
      .from(asset)
      .where(where)
      .orderBy(desc(asset.capturedAt), asset.id)
      .limit(30)
      .offset((page - 1) * 30),
    db.select({ count: count() }).from(asset).where(where),
    db
      .select()
      .from(archive)
      .where(eq(archive.meetingId, meetingId))
      .orderBy(desc(archive.startedAt)),
    db
      .select({ count: count(), kind: asset.kind, status: asset.status })
      .from(asset)
      .where(eq(asset.meetingId, meetingId))
      .groupBy(asset.kind, asset.status),
  ]);
  return {
    counts,
    page,
    pageSize: 30,
    records: records.map(({ storageKey: _key, storageBackend: _backend, ...row }) => ({
      ...row,
      capturedAt: row.capturedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      environment: hideStoredIp(row.environment),
    })),
    rooms: rooms.map(({ leaseOwner: _owner, leaseUntil: _until, ...r }) => ({
      ...r,
      endedAt: r.endedAt?.toISOString() ?? null,
      heartbeatAt: r.heartbeatAt?.toISOString() ?? null,
      startedAt: r.startedAt.toISOString(),
    })),
    total: total.count,
  };
}
export async function loadMediaContent(id: string, actorId: string) {
  const [stored] = await db
    .select({ organizationId: archive.organizationId, record: asset })
    .from(asset)
    .innerJoin(
      archive,
      and(eq(archive.roomSid, asset.roomSid), eq(archive.meetingId, asset.meetingId)),
    )
    .where(and(eq(asset.id, id), eq(asset.status, "ready")));
  const row = stored?.record;
  if (!row?.storageKey || !row.storageBackend || !row.contentType) {
    return null;
  }
  const storageKey = await decryptMediaStorageKey(row.storageKey, {
    id: row.id,
    meetingId: row.meetingId,
    organizationId: stored.organizationId,
    storageBackend: row.storageBackend,
  });
  const bytes = await readMedia(row.storageBackend, storageKey);
  await db.insert(access).values({ action: "view", actorId, assetId: id, id: randomUUID() });
  return { bytes, contentType: row.contentType };
}
export function deleteMediaAsset(id: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select({ organizationId: archive.organizationId, record: asset })
      .from(asset)
      .innerJoin(
        archive,
        and(eq(archive.roomSid, asset.roomSid), eq(archive.meetingId, asset.meetingId)),
      )
      .where(eq(asset.id, id))
      .for("update");
    const row = stored?.record;
    if (!row) {
      return "missing" as const;
    }
    if (row.status === "deleted") {
      return "deleted" as const;
    }
    if (row.status === "pending") {
      return "pending" as const;
    }
    // A failed object delete leaves the record retryable; never report cleanup before storage succeeds.
    if (row.storageKey && row.storageBackend) {
      const storageKey = await decryptMediaStorageKey(row.storageKey, {
        id: row.id,
        meetingId: row.meetingId,
        organizationId: stored.organizationId,
        storageBackend: row.storageBackend,
      });
      await removeMedia(row.storageBackend, storageKey);
    }
    await tx
      .update(asset)
      .set({ deletedAt: new Date(), deletedBy: actorId, status: "deleted" })
      .where(eq(asset.id, id));
    await tx.insert(access).values({ action: "delete", actorId, assetId: id, id: randomUUID() });
    return "deleted" as const;
  });
}
