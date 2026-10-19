import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  interviewMediaAccess as access,
  interviewMediaAsset as asset,
  interviewMediaRoom as archive,
  session,
  user,
} from "@arc/db-schema/schema";
import { createSecurityTestDatabase } from "../../../../../../../test-utils/security-database";
import { installSecurityTestKeys } from "../../../../../../../test-utils/security-keys";
import { runWithRequestPeerIp } from "../../../../../../../lib/server/request-ip-context";
import { decryptIp, ipContext } from "../../../../../../../lib/server/ip-encryption";
import { saveClientEvents } from "../../../../../public/routes/interview-telemetry/dao";
import {
  backfillEncryptedMediaLocations,
  verifyEncryptedMediaLocations,
} from "../../../../../../../scripts/backfill-encrypted-media-locations";
import type { Database } from "../../../../../../../lib/server/db";
import { finishMediaSample, reserveMediaSample } from "./capture";
import { deleteMediaAsset, loadMediaContent, loadMeetingMedia } from "./dao";
import * as encryption from "./encryption";
import { writeMedia } from "./storage";
import { factory } from "../../../../../../factory";
import { platformMfaMiddleware } from "../../../../../../middlewares/platform-mfa";
import { beginMfaEnrollment, verifyMfa } from "../../../../../security/mfa/service";
import { MFA_COOKIE } from "../../../../../security/mfa/policy";
import { createInterviewMediaRouter } from "./route";

const state = vi.hoisted(() => ({
  database: null as Awaited<ReturnType<typeof createSecurityTestDatabase>> | null,
}));
function database() {
  if (!state.database) {
    throw new Error("Test database not initialized");
  }
  return state.database.db;
}
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  get db() {
    return database();
  },
}));
let directory: string;
beforeAll(async () => {
  installSecurityTestKeys();
  state.database = await createSecurityTestDatabase();
  directory = await mkdtemp(join(tmpdir(), "arc-encrypted-media-"));
  vi.stubEnv("INTERVIEW_MEDIA_LOCAL_DIR", directory);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("BETTER_AUTH_URL", "https://arc.example.invalid");
});
afterAll(async () => {
  await state.database?.client.close();
  await rm(directory, { force: true, recursive: true });
  vi.unstubAllEnvs();
});

async function newRoom() {
  const [room] = await database()
    .insert(archive)
    .values({
      leaseOwner: "sampler",
      leaseUntil: new Date(Date.now() + 60_000),
      meetingId: randomUUID(),
      meetingTitle: "Encrypted media test",
      organizationId: randomUUID(),
      roomName: randomUUID(),
      roomSid: randomUUID(),
      status: "capturing",
    })
    .returning();
  return room;
}
async function reserve(roomSid: string, kind: "audio" | "image" = "image") {
  const row = await reserveMediaSample({
    kind,
    owner: "sampler",
    participant: { identity: "candidate_test", metadata: "{}", name: "Test", sid: randomUUID() },
    roomSid,
    slot: randomUUID(),
  });
  if (!row) {
    throw new Error("Expected media reservation");
  }
  return row;
}

describe("encrypted media persistence and explicit content access", () => {
  it("checks current MFA before reaching the media reader and returns only bytes after verification", async () => {
    const room = await newRoom();
    const sample = await reserve(room.roomSid);
    await finishMediaSample(sample, "sampler", {
      bytes: new Uint8Array([7, 8]),
      contentType: "image/jpeg",
    });
    const [admin] = await database()
      .insert(user)
      .values({
        email: `${randomUUID()}@example.invalid`,
        id: randomUUID(),
        name: "Test admin",
        role: "admin",
      })
      .returning();
    const [login] = await database()
      .insert(session)
      .values({
        expiresAt: new Date(Date.now() + 86_400_000),
        id: randomUUID(),
        token: randomUUID(),
        updatedAt: new Date(),
        userId: admin.id,
      })
      .returning();
    const principal = { sessionId: login.id, userId: admin.id };
    const content = vi.fn(loadMediaContent);
    const app = factory
      .createApp()
      .use(async (c, next) => {
        c.set("user", admin as typeof c.var.user);
        c.set("session", login as typeof c.var.session);
        await next();
      })
      .use(platformMfaMiddleware)
      .route(
        "/media",
        createInterviewMediaRouter({
          content,
          detail: loadMeetingMedia,
          list: vi.fn(),
          remove: deleteMediaAsset,
        }),
      );
    const path = `/media/assets/${sample.id}/content`;
    const denied = await app.request(path);
    expect(denied.status).toBe(403);
    expect(content).not.toHaveBeenCalled();
    const enrollment = await beginMfaEnrollment(principal);
    const grant = await verifyMfa(principal, {
      code: await generate({ secret: enrollment.secret }),
      method: "totp",
    });
    const response = await app.request(path, {
      headers: { cookie: `${MFA_COOKIE}=${grant.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([7, 8]));
    expect(content).toHaveBeenCalledOnce();
  });

  it("captures with only a public key, keeps plaintext out of the database and decrypts only on content access", async () => {
    const room = await newRoom();
    const privateKey = process.env.IP_ENCRYPTION_PRIVATE_KEY;
    vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", "");
    const sample = await reserve(room.roomSid);
    try {
      expect(sample.storageKey).toMatch(/^media-location:v1:/);
      expect(sample.uploadKey).not.toContain(sample.id);
      await finishMediaSample(sample, "sampler", {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/jpeg",
      });
    } finally {
      vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", privateKey);
    }
    const [stored] = await database().select().from(asset).where(eq(asset.id, sample.id));
    expect(stored.storageKey).not.toContain(sample.uploadKey);
    const decrypt = vi.spyOn(encryption, "decryptMediaStorageKey");
    try {
      const detail = await loadMeetingMedia(room.meetingId, { page: 1 });
      expect(detail.records[0]).not.toHaveProperty("storageKey");
      expect(detail.records[0]).not.toHaveProperty("uploadKey");
      expect(decrypt).not.toHaveBeenCalled();
      const preview = await loadMediaContent(sample.id, "admin");
      expect(preview?.bytes).toEqual(Buffer.from([1, 2, 3]));
      expect(decrypt).toHaveBeenCalledOnce();
    } finally {
      decrypt.mockRestore();
    }
    const views = await database().select().from(access).where(eq(access.assetId, sample.id));
    expect(views.map((row) => row.action)).toEqual(["view"]);
  });

  it("rejects a location copied to another record and preserves a file when decryption for cleanup fails", async () => {
    const room = await newRoom();
    const sample = await reserve(room.roomSid, "audio");
    assert.ok(sample.uploadKey);
    await finishMediaSample(sample, "sampler", {
      bytes: new Uint8Array([4, 5]),
      contentType: "audio/wav",
    });
    const other = await reserve(room.roomSid, "audio");
    await database()
      .update(asset)
      .set({ contentType: "audio/wav", status: "ready", storageKey: sample.storageKey })
      .where(eq(asset.id, other.id));
    await expect(loadMediaContent(other.id, "admin")).rejects.toThrow();
    await database()
      .update(asset)
      .set({ storageKey: other.storageKey })
      .where(eq(asset.id, other.id));
    const privateKey = process.env.IP_ENCRYPTION_PRIVATE_KEY;
    vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", "");
    try {
      await expect(deleteMediaAsset(sample.id, "admin")).rejects.toThrow();
    } finally {
      vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", privateKey);
    }
    expect(await readFile(join(directory, sample.uploadKey))).toEqual(Buffer.from([4, 5]));
    const [preserved] = await database().select().from(asset).where(eq(asset.id, sample.id));
    expect(preserved.status).toBe("ready");
    expect(await deleteMediaAsset(sample.id, "admin")).toBe("deleted");
    await expect(readFile(join(directory, sample.uploadKey))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("migrates existing addresses without changing files, is idempotent and verifies with the reader's private key", async () => {
    const room = await newRoom();
    const sample = await reserve(room.roomSid);
    const key = `human-interview-samples/${randomUUID()}.jpg`;
    await writeMedia("local", key, new Uint8Array([8, 9]), "image/jpeg");
    await database()
      .update(asset)
      .set({ contentType: "image/jpeg", status: "ready", storageKey: key })
      .where(eq(asset.id, sample.id));
    const db = database() as unknown as Database;
    expect(await backfillEncryptedMediaLocations(db)).toEqual({
      invalidLocations: 0,
      remainingPlaintext: 1,
      unreadableReferences: 0,
    });
    await expect(loadMediaContent(sample.id, "admin")).rejects.toThrow("migration");
    const privateKey = process.env.IP_ENCRYPTION_PRIVATE_KEY;
    vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", "");
    try {
      expect(await backfillEncryptedMediaLocations(db, true)).toEqual({
        invalidLocations: 0,
        remainingPlaintext: 0,
        unreadableReferences: 0,
      });
    } finally {
      vi.stubEnv("IP_ENCRYPTION_PRIVATE_KEY", privateKey);
    }
    const [stored] = await database().select().from(asset).where(eq(asset.id, sample.id));
    expect(stored.storageKey).toMatch(/^media-location:v1:/);
    await backfillEncryptedMediaLocations(db, true);
    const [repeated] = await database().select().from(asset).where(eq(asset.id, sample.id));
    expect(repeated.storageKey).toBe(stored.storageKey);
    const verification = await verifyEncryptedMediaLocations(db);
    expect(verification.verified).toBeGreaterThan(0);
    const preview = await loadMediaContent(sample.id, "admin");
    expect(preview?.bytes).toEqual(Buffer.from([8, 9]));
  });

  it("migrates and verifies more than one batch without skipping addresses", async () => {
    const room = await newRoom();
    const db = database() as unknown as Database;
    const before = await verifyEncryptedMediaLocations(db);
    await database()
      .insert(asset)
      .values(
        Array.from({ length: 205 }, (_, index) => ({
          capturedAt: new Date(),
          id: randomUUID(),
          kind: "image" as const,
          meetingId: room.meetingId,
          participantIdentity: "candidate_batch",
          participantName: "Batch test",
          participantRole: "candidate",
          participantSid: "batch-participant",
          roomSid: room.roomSid,
          slot: String(index),
          status: "failed" as const,
          storageBackend: "local" as const,
          storageKey: `human-interview-samples/${randomUUID()}.jpg`,
        })),
      );
    const inspection = await backfillEncryptedMediaLocations(db);
    expect(inspection.remainingPlaintext).toBe(205);
    expect(await backfillEncryptedMediaLocations(db, true)).toEqual({
      invalidLocations: 0,
      remainingPlaintext: 0,
      unreadableReferences: 0,
    });
    const after = await verifyEncryptedMediaLocations(db);
    expect(after.verified).toBe(before.verified + 205);
  });

  it("refuses orphaned references before changing any other plaintext address", async () => {
    const room = await newRoom();
    const valid = await reserve(room.roomSid);
    const orphan = await reserve(room.roomSid);
    const key = `human-interview-samples/${randomUUID()}.jpg`;
    await database().update(asset).set({ storageKey: key }).where(eq(asset.id, valid.id));
    await database()
      .update(asset)
      .set({ roomSid: "missing-room", storageKey: key })
      .where(eq(asset.id, orphan.id));
    const db = database() as unknown as Database;
    const inspection = await backfillEncryptedMediaLocations(db);
    expect(inspection.unreadableReferences).toBe(1);
    await expect(backfillEncryptedMediaLocations(db, true)).rejects.toThrow(
      "valid archive references",
    );
    const [unchanged] = await database().select().from(asset).where(eq(asset.id, valid.id));
    expect(unchanged.storageKey).toBe(key);
  });

  it.each([false, true])(
    "copies encrypted IP evidence into media with proxy trust=%s",
    async (trusted) => {
      vi.stubEnv("INTERVIEW_TELEMETRY_TRUSTED_PROXIES", trusted ? "127.0.0.1" : "");
      const room = await newRoom();
      const trace = { attemptId: randomUUID(), tabId: randomUUID(), visitId: randomUUID() };
      const participant = {
        identity: `candidate_${randomUUID()}`,
        metadata: JSON.stringify({ interview_trace: trace, participant_role: "candidate" }),
        name: "IP evidence test",
        sid: randomUUID(),
      };
      const expectedIp = trusted ? "203.0.113.55" : "192.0.2.55";
      await runWithRequestPeerIp(trusted ? "127.0.0.1" : expectedIp, () =>
        saveClientEvents(
          {
            meetingId: room.meetingId,
            meetingTitle: room.meetingTitle,
            organizationId: room.organizationId,
            participantIdentity: participant.identity,
            participantName: participant.name,
            participantRole: "candidate",
            roomName: room.roomName,
          },
          [
            {
              ...trace,
              clientSequence: 1,
              details: {},
              id: randomUUID(),
              occurredAt: new Date().toISOString(),
              type: "connected",
            },
          ],
          new Headers({ "x-real-ip": "203.0.113.55" }),
        ),
      );
      const sample = await reserveMediaSample({
        kind: "audio",
        owner: "sampler",
        participant,
        roomSid: room.roomSid,
        slot: randomUUID(),
      });
      assert.ok(sample);
      await finishMediaSample(sample, "sampler", {
        bytes: new Uint8Array([7, 8]),
        contentType: "audio/wav",
      });
      const [stored] = await database().select().from(asset).where(eq(asset.id, sample.id));
      expect(stored.environment.ip).toMatch(/^ip:v1:/);
      expect(
        await decryptIp(
          stored.environment.ip ?? "",
          ipContext("media", room.organizationId, stored.id),
        ),
      ).toBe(expectedIp);
      expect(stored.environment.ipSource).toBe(
        trusted ? "trusted-proxy:x-real-ip" : "direct-connection",
      );
      const dto = await loadMeetingMedia(room.meetingId, { page: 1 });
      expect(dto.records[0].environment.hasIp).toBe(true);
      expect(JSON.stringify(dto)).not.toContain(expectedIp);
      expect(JSON.stringify(dto)).not.toContain("ip:v1:");
    },
  );
});
