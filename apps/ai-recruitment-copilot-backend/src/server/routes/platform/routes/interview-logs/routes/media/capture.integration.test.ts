/* oxlint-disable unicorn/no-await-expression-member -- Keep integration assertions next to the awaited database observation. */
import { randomUUID } from "node:crypto";
import { installSecurityTestKeys } from "../../../../../../../test-utils/security-keys";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { db as database } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import type * as captureModule from "./capture";
import type * as daoModule from "./dao";

const testUrl = process.env.INTERVIEW_MEDIA_TEST_DATABASE_URL ?? "";
const suite = testUrl ? describe : describe.skip;
suite("interview media archive persistence", () => {
  let db: typeof database;
  let capture: typeof captureModule;
  let dao: typeof daoModule;
  let directory: string;
  const meetingId = randomUUID();
  const roomSid = `RM_${randomUUID()}`;
  const roomName = `human_${meetingId}`;
  const identity = `candidate_${randomUUID()}`;
  const trace = { attemptId: randomUUID(), tabId: randomUUID(), visitId: randomUUID() };
  const participant = {
    identity,
    metadata: JSON.stringify({
      interview_trace: trace,
      participant_role: "candidate",
      secret: "not-evidence",
    }),
    name: "留底测试候选人",
    sid: "PA_test",
  };
  beforeAll(async () => {
    installSecurityTestKeys();
    const url = new URL(testUrl);
    if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith("/arc_media_test_")) {
      throw new Error("Isolated local media test database required");
    }
    vi.stubEnv("DATABASE_URL", testUrl);
    directory = await mkdtemp(join(tmpdir(), "arc-media-test-"));
    vi.stubEnv("INTERVIEW_MEDIA_LOCAL_DIR", directory);
    ({ db } = await import("@arc/ai-recruitment-copilot-backend/lib/server/db"));
    capture = await import("./capture");
    dao = await import("./dao");
    const org = randomUUID();
    await db.$client`insert into organization (id, name, slug, created_at) values (${org}, 'Test', ${org}, now())`;
    await db.$client`insert into studio_human_interview_meeting (id, organization_id, title, livekit_room_name) values (${meetingId}, ${org}, '留底隔离测试', ${roomName})`;
    for (const [index, attempt, ip, browserId] of [
      [0, trace.attemptId, "203.0.113.8", "device-test"],
      [1, "other-attempt", "203.0.113.9", null],
    ] as const) {
      await db.$client`insert into interview_telemetry_event (id, event_key, meeting_id, meeting_title, organization_id, participant_identity, occurred_at, received_at, source, type, attempt_id, visit_id, ip, ip_source, user_agent, browser_id)
      values (${randomUUID()}, ${randomUUID()}, ${meetingId}, '留底隔离测试', ${org}, ${identity}, now(), now() + ${`${index} seconds`}::interval, 'server', 'token_issued', ${attempt}, ${trace.visitId}, ${ip}, 'test-proxy', 'Test browser', ${browserId})`;
    }
    await db.$client`insert into interview_telemetry_event (id, event_key, meeting_id, meeting_title, organization_id, participant_identity, occurred_at, source, type, visit_id, fingerprint_id)
      values (${randomUUID()}, ${randomUUID()}, ${meetingId}, '留底隔离测试', ${org}, ${identity}, now(), 'client', 'fingerprint_ready', ${trace.visitId}, ${"a".repeat(32)})`;
  });
  afterAll(async () => {
    await (await import("@arc/ai-recruitment-copilot-backend/lib/server/db")).closeDatabase();
    await rm(directory, { force: true, recursive: true });
    vi.unstubAllEnvs();
  });
  it("leases each room once and rejects duplicate sample slots; retains exact connection evidence", async () => {
    await capture.ensureMediaRoom(roomName, roomSid);
    const claims = await Promise.all([
      capture.claimMediaRoom(roomSid, "one"),
      capture.claimMediaRoom(roomSid, "two"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims[0] ? "one" : "two";
    const input = { kind: "audio" as const, owner, participant, roomSid, slot: "1" };
    const samples = await Promise.all([
      capture.reserveMediaSample(input),
      capture.reserveMediaSample(input),
    ]);
    expect(samples.filter(Boolean)).toHaveLength(1);
    const sample = samples.find(Boolean);
    if (!sample) {
      throw new Error("Expected media reservation");
    }
    expect(sample.environment).toMatchObject({
      browserId: "device-test",
      fingerprint: "a".repeat(32),
      ip: expect.stringMatching(/^ip:v1:/),
      ...trace,
    });
    expect(JSON.stringify(sample)).not.toContain("not-evidence");
    await capture.finishMediaSample(sample, owner, {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
      durationMs: 15_000,
    });
    expect([...((await dao.loadMediaContent(sample.id, "admin"))?.bytes ?? [])]).toEqual([1, 2, 3]);
    const detail = await dao.loadMeetingMedia(meetingId, { page: 1 });
    expect(detail.records[0].sha256).toHaveLength(64);
    expect(detail.records[0]).not.toHaveProperty("storageKey");

    // Ordinary telemetry and the recruiting meeting may be removed independently.
    await db.$client`delete from interview_telemetry_event where meeting_id = ${meetingId}`;
    await db.$client`delete from studio_human_interview_meeting where id = ${meetingId}`;
    expect((await dao.listMediaArchives({ page: 1 })).records[0].meetingId).toBe(meetingId);
    expect((await dao.loadMeetingMedia(meetingId, { page: 1 })).records[0].environment.hasIp).toBe(
      true,
    );
    expect(JSON.stringify(await dao.loadMeetingMedia(meetingId, { page: 1 }))).not.toContain(
      "203.0.113.8",
    );

    vi.stubEnv("NODE_ENV", "production");
    await expect(dao.deleteMediaAsset(sample.id, "admin")).rejects.toThrow();
    expect((await dao.loadMeetingMedia(meetingId, { page: 1 })).records[0].status).toBe("ready");
    vi.stubEnv("NODE_ENV", "test");
    expect(await dao.deleteMediaAsset(sample.id, "admin")).toBe("deleted");
    expect(await dao.loadMediaContent(sample.id, "admin")).toBeNull();
    expect(await dao.deleteMediaAsset(sample.id, "admin")).toBe("deleted");
    const audit =
      await db.$client`select action from interview_media_access where asset_id = ${sample.id}`;
    expect(audit.map((r) => r.action).toSorted()).toEqual(["delete", "view"]);

    // Lease loss fences subsequent uploads; pending rows recover to failed for manual cleanup.
    const pending = await capture.reserveMediaSample({ ...input, slot: "2" });
    if (!pending) {
      throw new Error("Expected pending reservation");
    }
    await capture.releaseMediaRoom(roomSid, owner);
    await expect(
      capture.finishMediaSample(pending, owner, {
        bytes: new Uint8Array([1]),
        contentType: "audio/wav",
      }),
    ).rejects.toThrow("lease lost");
    await db.$client`update interview_media_asset set captured_at = now() - interval '3 minutes' where id = ${pending.id}`;
    await capture.repairInterruptedSamples();
    const failed = await dao.loadMeetingMedia(meetingId, { page: 1, status: "issues" });
    expect(failed.records[0].errorCode).toBe("capture_interrupted");
  });
});
