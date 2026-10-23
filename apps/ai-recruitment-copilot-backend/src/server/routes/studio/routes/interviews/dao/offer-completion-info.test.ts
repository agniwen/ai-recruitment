import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import {
  member,
  organization,
  recruitingGroup,
  recruitingGroupMember,
  studioInterview,
  user,
} from "@arc/db-schema/schema";
import { CANDIDATE, FIRST_SSC, ORG, setupOfferSscFixture } from "../__tests__/offer-ssc-fixture";
import { loadOfferCompletionInfo } from "./offer-completion-info";

setupOfferSscFixture();
const FOREIGN_ORG = `${ORG}_completion_foreign`;
const SECOND_GROUP = `${ORG}_completion_second`;
const FOREIGN_GROUP = `${ORG}_completion_foreign_group`;
const confirmationInfo = offerConfirmationDetailsSchema.parse({
  candidateCode: "ZCLT00089",
  candidateName: "Offer 中的姓名",
  candidatePrivateTelegram: "@candidate_private",
});

beforeEach(async () => {
  await db
    .update(studioInterview)
    .set({
      candidateName: "实时简历姓名",
      createdBy: FIRST_SSC,
      recruitmentSource: "other",
      recruitmentSourceDetail: "林图",
    })
    .where(eq(studioInterview.id, CANDIDATE));
  await db
    .update(user)
    .set({ banned: false, telegram: "@Recruiter_123" })
    .where(eq(user.id, FIRST_SSC));
  await db
    .insert(member)
    .values({
      id: `${ORG}_completion_uploader`,
      organizationId: ORG,
      role: "hr",
      userId: FIRST_SSC,
    })
    .onConflictDoNothing();
  await db
    .insert(organization)
    .values({ id: FOREIGN_ORG, name: "Foreign", slug: FOREIGN_ORG })
    .onConflictDoNothing();
  await db
    .insert(recruitingGroup)
    .values([
      { id: SECOND_GROUP, name: "另一招聘组", organizationId: ORG },
      { id: FOREIGN_GROUP, name: "跨工作区不应展示", organizationId: FOREIGN_ORG },
    ])
    .onConflictDoNothing();
  await db
    .insert(recruitingGroupMember)
    .values([
      {
        groupId: SECOND_GROUP,
        id: `${SECOND_GROUP}_membership`,
        organizationId: ORG,
        role: "hr",
        userId: FIRST_SSC,
      },
      {
        groupId: FOREIGN_GROUP,
        id: `${FOREIGN_GROUP}_membership`,
        organizationId: FOREIGN_ORG,
        role: "hr",
        userId: FIRST_SSC,
      },
    ])
    .onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, FOREIGN_ORG));
});

async function snapshot(
  overrides: Partial<{
    organizationId: string;
    confirmationInfo: typeof confirmationInfo | null;
  }> = {},
) {
  return await loadOfferCompletionInfo(
    {
      confirmationInfo,
      interviewRecordId: CANDIDATE,
      organizationId: ORG,
      preboardingDate: "2026-11-01",
      ...overrides,
    },
    db,
  );
}

describe("Offer final recruitment and preboarding snapshot", () => {
  it("uses the original uploader's current workspace teams and TG with the uploaded source", async () => {
    const info = await snapshot();
    expect(info).toEqual({
      candidateCode: "ZCLT00089",
      candidateName: "Offer 中的姓名",
      candidatePrivateTelegram: "@candidate_private",
      preboardingDate: "2026-11-01",
      recruiterTelegram: "@Recruiter_123",
      recruitingGroupNames: ["SSC 可见范围测试组", "另一招聘组"],
      recruitmentChannel: "其他",
      resumeSource: "林图",
    });
    expect(info.recruitingGroupNames).not.toContain("跨工作区不应展示");
  });

  it("falls back to the recorded source label when no source detail was uploaded", async () => {
    await db
      .update(studioInterview)
      .set({ recruitmentSource: "tg", recruitmentSourceDetail: null })
      .where(eq(studioInterview.id, CANDIDATE));
    expect(await snapshot()).toMatchObject({ recruitmentChannel: "TG", resumeSource: "TG" });
  });

  it("leaves missing upload source and inactive uploader contact data empty without guessing", async () => {
    await db
      .update(studioInterview)
      .set({ recruitmentSource: null, recruitmentSourceDetail: null })
      .where(eq(studioInterview.id, CANDIDATE));
    await db.update(user).set({ banned: true }).where(eq(user.id, FIRST_SSC));
    expect(await snapshot()).toMatchObject({
      recruiterTelegram: null,
      recruitingGroupNames: [],
      recruitmentChannel: null,
      resumeSource: null,
    });
  });

  it("does not use cross-workspace group membership when the uploader has left this workspace", async () => {
    await db
      .delete(member)
      .where(and(eq(member.organizationId, ORG), eq(member.userId, FIRST_SSC)));
    expect(await snapshot()).toMatchObject({ recruiterTelegram: null, recruitingGroupNames: [] });
  });

  it("uses the candidate record name for a historical Offer without a confirmation snapshot", async () => {
    expect(await snapshot({ confirmationInfo: null })).toMatchObject({
      candidateCode: null,
      candidateName: "实时简历姓名",
      candidatePrivateTelegram: null,
    });
  });

  it("rejects a candidate outside the requested workspace", async () => {
    await expect(snapshot({ organizationId: FOREIGN_ORG })).rejects.toThrow("候选人记录不存在");
  });
});
