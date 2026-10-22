import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { withTelegramOfferRecruiterState } from "./offer-recruiter-state";
import { withTelegramOfferCompletionState } from "./offer-ssc-state";

const testDatabaseUrl = process.env.SSC_TELEGRAM_TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl || testDatabaseUrl !== process.env.DATABASE_URL)(
  "concurrent durable recruiter and SSC conversation state",
  () => {
    it("preserves both workflows with PostgreSQL locking and whole-document replacement", async () => {
      const chatId = String(randomInt(10_000_000, 999_999_999));
      const draftId = randomUUID();
      const recruiterToken = randomUUID().replaceAll("-", "");
      const sscToken = randomUUID().replaceAll("-", "");
      let stored: Record<string, unknown> = { otherWorkflow: "preserved" };
      const thread = {
        async setState(value: Record<string, unknown>) {
          // Model the SDK's whole-document state replacement, with an asynchronous write.
          await delay(15);
          stored = structuredClone(value);
        },
        get state() {
          return Promise.resolve(structuredClone(stored));
        },
      };
      await Promise.all([
        withTelegramOfferRecruiterState(thread, chatId, (pending) => {
          pending[recruiterToken] = {
            candidatePrivateTelegram: null,
            chatId,
            draftId,
            expiresAt: Date.now() + 60_000,
            interviewRecordId: "candidate",
            organizationId: "workspace",
            phase: "input",
            promptMessageId: 100,
            revision: 1,
            telegramUsername: "recruiter_test",
          };
        }),
        withTelegramOfferCompletionState(thread, chatId, (pending) => {
          pending[sscToken] = {
            chatId,
            draftId,
            expiresAt: Date.now() + 60_000,
            interviewRecordId: "candidate",
            organizationId: "workspace",
            promptMessageId: 200,
            revision: 1,
            status: "pending",
          };
        }),
      ]);
      expect(stored.otherWorkflow).toBe("preserved");
      expect(stored.offerRecruiterContacts).toHaveProperty(recruiterToken);
      expect(stored.offerSscCompletions).toHaveProperty(sscToken);
    });
  },
);
