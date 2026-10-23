import { eq } from "drizzle-orm";
import { afterAll, beforeAll } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { createOfferDraft } from "../dao/offer-drafts";
import { offerDraftsRouter } from "../routes/offer-drafts/route";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  member,
  organization,
  organizationRole,
  recruitingGroup,
  recruitingGroupMember,
  studioInterview,
  studioOfferDraft,
  user,
} from "@arc/db-schema/schema";

export const ORG = "test_offer_ssc_org";
export const CANDIDATE = "test_offer_ssc_candidate";
export const FIRST_SSC = "test_offer_ssc_first";
export const SECOND_SSC = "test_offer_ssc_second";
export const FORBIDDEN_USER = "test_offer_ssc_forbidden";
export const RECEIVE_ONLY_SSC = "test_offer_ssc_receive_only";
export const CONFIRM_ONLY_SSC = "test_offer_ssc_confirm_only";
const FIXTURE_MEMBERS = [
  { id: FIRST_SSC, role: "owner" },
  { id: SECOND_SSC, role: "owner" },
  { id: FORBIDDEN_USER, role: "noAccess" },
  { id: RECEIVE_ONLY_SSC, role: "sscReceiveOnly" },
  { id: CONFIRM_ONLY_SSC, role: "sscConfirmOnly" },
];
export const INPUT = { baseSalary: 30_000, currency: "CNY", position: "工程师" };

async function cleanup() {
  await db.delete(organization).where(eq(organization.id, ORG));
  for (const { id } of FIXTURE_MEMBERS) {
    await db.delete(user).where(eq(user.id, id));
  }
}

async function seedFixture() {
  await cleanup();
  await db.insert(organization).values({ id: ORG, name: "Offer SSC test", slug: ORG });
  await db.insert(organizationRole).values([
    {
      id: `${ORG}_receive_role`,
      name: "SSC 接收确认测试角色",
      organizationId: ORG,
      permission: JSON.stringify({ offer: ["read", "receive"] }),
      role: "sscReceiveOnly",
    },
    {
      id: `${ORG}_confirm_role`,
      name: "SSC 完成确认测试角色",
      organizationId: ORG,
      permission: JSON.stringify({ offer: ["read", "confirm"] }),
      role: "sscConfirmOnly",
    },
  ]);
  for (const { id, role } of FIXTURE_MEMBERS) {
    await db.insert(user).values({ email: `${id}@example.com`, id, name: id });
    await db.insert(member).values({
      id: `${id}_membership`,
      organizationId: ORG,
      role,
      userId: id,
    });
  }
  const groupId = `${ORG}_recruiting_group`;
  await db.insert(recruitingGroup).values({
    id: groupId,
    name: "SSC 可见范围测试组",
    organizationId: ORG,
  });
  // Both custom roles can see the creator's candidate through the real group
  // hierarchy; neither relies on owner/admin visibility or an ODC source map.
  await db.insert(recruitingGroupMember).values([
    { groupId, id: `${groupId}_creator`, organizationId: ORG, role: "hr", userId: FIRST_SSC },
    {
      groupId,
      id: `${groupId}_receiver`,
      organizationId: ORG,
      role: "recruitingLead",
      userId: RECEIVE_ONLY_SSC,
    },
    {
      groupId,
      id: `${groupId}_confirmer`,
      organizationId: ORG,
      role: "recruitingLead",
      userId: CONFIRM_ONLY_SSC,
    },
  ]);
  await db.insert(studioInterview).values({
    candidateName: "SSC 候选人",
    createdBy: FIRST_SSC,
    id: CANDIDATE,
    organizationId: ORG,
    pipelineStage: "offer",
  });
}

export function setupOfferSscFixture() {
  beforeAll(seedFixture);
  afterAll(cleanup);
}

export function makeApp(actorId = FIRST_SSC) {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: ORG } as never);
      c.set("user", { id: actorId } as never);
      // Deliberately spoof the request role for restricted fixture users. The shared
      // service must read the actual membership rather than trust this value.
      c.set("member", { role: "owner" } as never);
      await next();
    })
    .route("/:id/offer-drafts", offerDraftsRouter);
}

export function requestAction(
  draftId: string,
  action: "receive" | "complete",
  revision = 1,
  actorId = FIRST_SSC,
  recordId = CANDIDATE,
) {
  return makeApp(actorId).request(`/${recordId}/offer-drafts/${draftId}/ssc/${action}`, {
    body: JSON.stringify({
      ...(action === "complete" ? { internalApprovalConfirmed: true } : {}),
      revision,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export async function newLegacySscOffer() {
  const draft = await createOfferDraft({
    input: INPUT,
    interviewRecordId: CANDIDATE,
    organizationId: ORG,
  });
  // This fixture isolates the historical SSC lifecycle. The recruiter gate has
  // dedicated coverage in dao/offer-recruiter-contact.test.ts; preboarding-date
  // validation has its own suite and this fixture isolates later SSC transitions.
  await db
    .update(studioOfferDraft)
    .set({ preboardingDate: "2026-11-01", recruiterConfirmationStatus: null })
    .where(eq(studioOfferDraft.id, draft.id));
  return { ...draft, preboardingDate: "2026-11-01", recruiterConfirmationStatus: null };
}
