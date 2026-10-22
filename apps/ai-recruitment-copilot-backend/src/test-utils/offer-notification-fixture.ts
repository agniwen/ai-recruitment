import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { member, studioInterview, user } from "@arc/db-schema/schema";
import { createOfferDraft } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-drafts";
import { submitOfferRecruiterContact } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/interviews/dao/offer-recruiter-contact";

interface RecruiterOfferFixtureInput {
  input: Parameters<typeof createOfferDraft>[0]["input"];
  interviewRecordId: string;
  organizationId: string;
  userIds: string[];
}

/** A distinct, active uploader; none of these fields create or grant an SSC identity. */
export async function createOfferWithRecruiterFixture(input: RecruiterOfferFixtureInput) {
  const recruiterId = randomUUID();
  const recruiterChatId = String(randomInt(1_000_000, 999_999_999_999));
  const recruiterUsername = `recruiter_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  input.userIds.push(recruiterId);
  await db.insert(user).values({
    email: `${recruiterId}@example.com`,
    id: recruiterId,
    name: "Resume uploader",
    telegram: `@${recruiterUsername}`,
    telegramBoundUsername: recruiterUsername,
    telegramChatId: recruiterChatId,
  });
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    role: "member",
    userId: recruiterId,
  });
  await db
    .update(studioInterview)
    .set({ createdBy: recruiterId })
    .where(eq(studioInterview.id, input.interviewRecordId));
  const draft = await createOfferDraft({
    actorId: recruiterId,
    actorRole: "member",
    input: input.input,
    interviewRecordId: input.interviewRecordId,
    organizationId: input.organizationId,
  });
  if (draft.sscRevision === undefined) {
    throw new Error("Expected a new Offer enrolled in SSC confirmation");
  }
  return { draft, recruiterChatId, recruiterId, revision: draft.sscRevision };
}

/** System submission may precede TG delivery; SSC routing is tested only after this gate. */
export async function createRecruiterConfirmedOfferFixture(input: RecruiterOfferFixtureInput) {
  const fixture = await createOfferWithRecruiterFixture(input);
  await submitOfferRecruiterContact({
    actorUserId: fixture.recruiterId,
    candidatePrivateTelegram: "@CandidatePrivate",
    draftId: fixture.draft.id,
    interviewRecordId: input.interviewRecordId,
    organizationId: input.organizationId,
    revision: fixture.revision,
    source: "system",
  });
  return { id: fixture.draft.id };
}
