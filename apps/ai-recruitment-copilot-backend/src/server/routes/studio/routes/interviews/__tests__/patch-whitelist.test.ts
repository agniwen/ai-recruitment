// Verify that PATCH /api/w/:slug/studio/interviews/:id ignores candidate
// fields in the request body. Candidate identity is now owned by the
// resume library; leaving this path writable would let bugs in the editor
// silently overwrite candidate data.
// 验证 PATCH 接口不会覆写候选人身份字段，这些字段由简历库专属管理。

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { studioInterviewDetailRouter } from "../detail-route";
import {
  member,
  organization,
  studioInterview,
  studioInterviewSchedule,
  user,
} from "@arc/db-schema/schema";

const ORG = "test_org_patch_whitelist";
const USER_ID = "test_user_patch_whitelist";
const RECORD_ID = "ri_patch_whitelist_1";
const ROUND_ID = "round_patch_whitelist_1";
const NOW = new Date("2026-05-13T12:00:00.000Z");

function makeApp(authenticated = true) {
  return factory
    .createApp()
    .use(async (c, next) => {
      if (authenticated) {
        c.set("activeOrg", { id: ORG } as never);
        c.set("member", { organizationId: ORG, role: "owner", userId: USER_ID } as never);
        c.set("user", { id: USER_ID } as never);
      }
      await next();
    })
    .route("/", studioInterviewDetailRouter);
}

async function cleanup() {
  await db
    .delete(studioInterviewSchedule)
    .where(eq(studioInterviewSchedule.interviewRecordId, RECORD_ID));
  await db.delete(studioInterview).where(eq(studioInterview.organizationId, ORG));
  await db.delete(member).where(eq(member.userId, USER_ID));
  await db.delete(organization).where(eq(organization.id, ORG));
  await db.delete(user).where(eq(user.id, USER_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(user).values({
    createdAt: NOW,
    email: "patch-whitelist@example.com",
    emailVerified: false,
    id: USER_ID,
    name: "patch-whitelist",
    updatedAt: NOW,
  });
  await db.insert(organization).values({
    createdAt: NOW,
    id: ORG,
    name: "Patch Org",
    slug: "test-patch-whitelist",
  });
  await db.insert(member).values({
    createdAt: NOW,
    id: "m_patch_whitelist",
    organizationId: ORG,
    role: "owner",
    userId: USER_ID,
  });
  await db.insert(studioInterview).values({
    aiReviewApprovalStatus: "approved",
    candidateEmail: "original@example.com",
    candidateName: "原始姓名",
    candidatePhone: "13800000000",
    createdAt: NOW,
    createdBy: USER_ID,
    id: RECORD_ID,
    interviewQuestions: [],
    notes: "原始评价",
    organizationId: ORG,
    pipelineStage: "screening",
    targetRole: "原始岗位",
    updatedAt: NOW,
  });
  await db.insert(studioInterviewSchedule).values({
    createdAt: NOW,
    createdBy: USER_ID,
    id: ROUND_ID,
    interviewRecordId: RECORD_ID,
    organizationId: ORG,
    roundLabel: "一面",
    sortOrder: 0,
    updatedAt: NOW,
  });
});

afterAll(async () => {
  await cleanup();
});

describe("interview PATCH whitelist (R7)", () => {
  it("updates the requested round while ignoring candidate-identity and pipeline fields", async () => {
    const response = await makeApp().request(`/${ROUND_ID}`, {
      body: JSON.stringify({
        allowTextInput: true,
        candidateEmail: "overwritten@example.com",
        candidateName: "被覆写姓名",
        candidatePhone: "13900000000",
        interviewQuestions: [{ difficulty: "easy", order: 1, question: "overwritten" }],
        notes: "轮次备注",
        outcome: "rejected",
        pipelineStage: "closed",
        targetRole: "被覆写岗位",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(200);
    const [candidate] = await db
      .select()
      .from(studioInterview)
      .where(eq(studioInterview.id, RECORD_ID))
      .limit(1);
    expect(candidate).toMatchObject({
      candidateEmail: "original@example.com",
      candidateName: "原始姓名",
      candidatePhone: "13800000000",
      interviewQuestions: [],
      notes: "原始评价",
      outcome: "in_pipeline",
      pipelineStage: "screening",
      targetRole: "原始岗位",
    });
    const [round] = await db
      .select()
      .from(studioInterviewSchedule)
      .where(eq(studioInterviewSchedule.id, ROUND_ID));
    expect(round).toMatchObject({ allowTextInput: true, notes: "轮次备注" });
  });

  it("rejects an anonymous PATCH before changing the round", async () => {
    const [before] = await db
      .select()
      .from(studioInterviewSchedule)
      .where(eq(studioInterviewSchedule.id, ROUND_ID));

    const response = await makeApp(false).request(`/${ROUND_ID}`, {
      body: JSON.stringify({ notes: "anonymous overwrite" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });

    expect(response.status).toBe(403);
    const [after] = await db
      .select()
      .from(studioInterviewSchedule)
      .where(eq(studioInterviewSchedule.id, ROUND_ID));
    expect(after).toEqual(before);
  });
});
