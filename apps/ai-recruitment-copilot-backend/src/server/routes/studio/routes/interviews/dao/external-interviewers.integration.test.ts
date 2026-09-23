import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, closeDatabase } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { createHumanInterviewRound, listHumanInterviewRounds } from "./human-interview-rounds";
import {
  createHumanInterviewMeeting,
  issueHumanInterviewMeetingLinks,
  resolveHumanInterviewMeetingInterviewerInviteToken,
  markHumanInterviewParticipantJoined,
  markHumanInterviewParticipantLeft,
} from "./human-interview-meetings";
import { buildInterviewerInviteToken, buildInviteExpiry } from "./human-interview-meeting-access";
import {
  loadExternalInterviewerDefaults,
  resolveExternalInterviewerBindings,
} from "./external-interviewers";

// Dedicated one-connection session. All writes target temporary tables; public data is never changed.
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", async () => {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { databaseCodecs } =
    await import("@arc/ai-recruitment-copilot-backend/lib/server/db/timestamp-codecs");
  const client = postgres(process.env.TEST_DATABASE_URL ?? "postgres://unused/unused", { max: 1 });
  return {
    closeDatabase: () => client.end({ timeout: 5 }),
    db: drizzle({ client, codecs: databaseCodecs }),
  };
});

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "external interviewers with temporary PostgreSQL tables",
  () => {
    beforeAll(async () => {
      vi.stubEnv("BETTER_AUTH_SECRET", "external-test-secret");
      for (const name of [
        "studio_interview",
        "studio_human_interview_round",
        "studio_human_interview_round_interviewer",
        "studio_human_interview_meeting",
        "studio_human_interview_meeting_round",
        "studio_human_interview_meeting_interviewer",
        "user",
        "member",
        "job_description",
        "telegram_requester_binding",
      ]) {
        await db.execute(
          sql.raw(
            `CREATE TEMP TABLE "${name}" (LIKE public."${name}" INCLUDING DEFAULTS INCLUDING INDEXES)`,
          ),
        );
      }
      const migration = readFileSync(
        new URL(
          "../../../../../../../../ai-recruitment-copilot/drizzle/20260923140000_add_human_interview_external_interviewer/migration.sql",
          import.meta.url,
        ),
        "utf-8",
      );
      await db.execute(
        sql.raw(
          migration.replace(
            'CREATE TABLE "studio_human_interview_external_interviewer"',
            'CREATE TEMP TABLE "studio_human_interview_external_interviewer"',
          ),
        ),
      );
      await db.execute(
        sql`INSERT INTO studio_interview (id,organization_id,candidate_name,pipeline_stage) VALUES ('candidate','org','测试候选人','human_interview')`,
      );
      await db.execute(
        sql`INSERT INTO telegram_requester_binding (organization_id,username,chat_id) VALUES ('org','tester1','123'),('other','tester2','999')`,
      );
    });
    afterAll(async () => {
      await closeDatabase();
      vi.unstubAllEnvs();
    });

    it("resolves binding only within the active organization", async () => {
      expect(
        await resolveExternalInterviewerBindings("org", [
          { name: "A", telegram: "@Tester1" },
          { name: "B", telegram: "@tester2" },
          { name: "C", telegram: "" },
        ]),
      ).toEqual([
        { chatId: "123", name: "A", telegram: "@Tester1" },
        { chatId: null, name: "B", telegram: "@tester2" },
        { chatId: null, name: "C", telegram: "" },
      ]);
      expect(await loadExternalInterviewerDefaults("candidate", "other")).toBeNull();
      expect(await loadExternalInterviewerDefaults("candidate", "org")).toEqual([]);
    });

    it("persists an external-only round and issues usable links even without TG", async () => {
      const round = await createHumanInterviewRound({
        input: {
          externalInterviewers: [
            { name: "张三", telegram: "@tester1" },
            { name: "李四", telegram: "" },
          ],
          format: "online",
          interviewerIds: [],
          label: "外部面试",
        },
        interviewRecordId: "candidate",
        organizationId: "org",
      });
      expect(round.externalInterviewers).toHaveLength(2);
      const meeting = await createHumanInterviewMeeting({
        createdBy: null,
        input: {
          interviewerIds: [],
          roundIds: [round.id],
          scheduledAt: new Date().toISOString(),
          title: "外部面试",
        },
        organizationId: "org",
      });
      expect(meeting.interviewers.map((item) => item.name)).toEqual(["张三", "李四"]);
      const [savedRound] = await listHumanInterviewRounds("candidate", "org");
      expect(savedRound.externalInterviewers).toHaveLength(2);
      const links = await issueHumanInterviewMeetingLinks({
        meetingId: meeting.id,
        organizationId: "org",
      });
      expect(links.interviewerLinks).toHaveLength(2);
      for (const link of links.interviewerLinks) {
        const token = decodeURIComponent(link.url.split("/").at(-1) ?? "");
        const scope = await resolveHumanInterviewMeetingInterviewerInviteToken(token);
        expect(scope).toMatchObject({
          interviewerName: link.name,
          meetingId: meeting.id,
          organizationId: "org",
          role: "interviewer",
          userId: `external_${link.userId}`,
        });
        expect(
          await resolveHumanInterviewMeetingInterviewerInviteToken(`${token}tampered`),
        ).toBeNull();
        const otherMeeting = buildInterviewerInviteToken({
          exp: buildInviteExpiry(),
          external: true,
          meetingId: "wrong-meeting",
          role: "interviewer",
          userId: link.userId,
        });
        expect(await resolveHumanInterviewMeetingInterviewerInviteToken(otherMeeting)).toBeNull();
        const expired = buildInterviewerInviteToken({
          exp: Date.now() - 1000,
          external: true,
          meetingId: meeting.id,
          role: "interviewer",
          userId: link.userId,
        });
        expect(await resolveHumanInterviewMeetingInterviewerInviteToken(expired)).toBeNull();
        const internal = buildInterviewerInviteToken({
          exp: buildInviteExpiry(),
          meetingId: meeting.id,
          role: "interviewer",
          userId: link.userId,
        });
        expect(await resolveHumanInterviewMeetingInterviewerInviteToken(internal)).toBeNull();
        await markHumanInterviewParticipantJoined({
          identity: `interviewer_external_${link.userId}`,
          roomName: meeting.liveKitRoomName ?? "",
        });
        await markHumanInterviewParticipantLeft({
          identity: `interviewer_external_${link.userId}`,
          roomName: meeting.liveKitRoomName ?? "",
        });
      }
      const attendance = await db.execute(
        sql`select joined_at, left_at from studio_human_interview_external_interviewer`,
      );
      expect(attendance.every((row) => row.joined_at && row.left_at)).toBe(true);
      await expect(
        issueHumanInterviewMeetingLinks({ meetingId: meeting.id, organizationId: "other" }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("rejects a round without any interviewer", async () => {
      await expect(
        createHumanInterviewRound({
          input: { format: "online", interviewerIds: [], label: "空面试" },
          interviewRecordId: "candidate",
          organizationId: "org",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
