import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { user } from "@arc/db-schema/schema";
import { pinSscTelegramIdentity } from "./ssc-telegram-binding";

const databaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;
const users: string[] = [];

async function account() {
  const id = randomUUID();
  users.push(id);
  await db.insert(user).values({ email: `${id}@example.com`, id, name: "SSC binding test" });
  return id;
}

afterEach(async () => {
  if (users.length) {
    await db.delete(user).where(inArray(user.id, users.splice(0)));
  }
});

describe.skipIf(!databaseUrl || databaseUrl !== process.env.DATABASE_URL)(
  "durable SSC Telegram identity",
  () => {
    it("pins the first numeric chat and remains idempotent without touching the user profile", async () => {
      const userId = await account();
      const chatId = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
      const before = await db.select().from(user).where(eq(user.id, userId));
      expect(await pinSscTelegramIdentity({ chatId, userId, username: "@SSC_Example" })).toBe(true);
      expect(await pinSscTelegramIdentity({ chatId, userId, username: "ssc_example" })).toBe(true);
      expect(await db.select().from(user).where(eq(user.id, userId))).toEqual(before);
    });

    it("does not transfer identity when a username moves to another chat or changes", async () => {
      const userId = await account();
      const chatId = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
      expect(await pinSscTelegramIdentity({ chatId, userId, username: "ssc_moving" })).toBe(true);
      expect(
        await pinSscTelegramIdentity({ chatId: `${chatId}1`, userId, username: "ssc_moving" }),
      ).toBe(false);
      expect(await pinSscTelegramIdentity({ chatId, userId, username: "ssc_changed" })).toBe(false);
      expect(await pinSscTelegramIdentity({ chatId, userId, username: "ssc_moving" })).toBe(true);
    });

    it("does not pin one numeric chat to two system users, including concurrent attempts", async () => {
      const first = await account();
      const second = await account();
      const chatId = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
      const results = await Promise.all([
        pinSscTelegramIdentity({ chatId, userId: first, username: "ssc_shared" }),
        pinSscTelegramIdentity({ chatId, userId: second, username: "ssc_shared" }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = results[0] ? first : second;
      const loser = results[0] ? second : first;
      expect(await pinSscTelegramIdentity({ chatId, userId: winner, username: "ssc_shared" })).toBe(
        true,
      );
      expect(await pinSscTelegramIdentity({ chatId, userId: loser, username: "ssc_shared" })).toBe(
        false,
      );
    });

    it("rejects malformed Telegram identities before pinning anything", async () => {
      const userId = await account();
      for (const input of [
        { chatId: "-123", username: "ssc_valid" },
        { chatId: "123", username: "123456" },
        { chatId: "123", username: "bad" },
        { chatId: "123", username: "https://t.me/ssc_valid" },
      ]) {
        expect(await pinSscTelegramIdentity({ ...input, userId })).toBe(false);
      }
    });

    it("does not move one pinned username to another user and numeric chat", async () => {
      const first = await account();
      const second = await account();
      const chatId = `${Date.now()}${Math.floor(Math.random() * 100_000)}`;
      expect(await pinSscTelegramIdentity({ chatId, userId: first, username: "ssc_owner" })).toBe(
        true,
      );
      expect(
        await pinSscTelegramIdentity({
          chatId: `${chatId}1`,
          userId: second,
          username: "ssc_owner",
        }),
      ).toBe(false);
    });
  },
);
