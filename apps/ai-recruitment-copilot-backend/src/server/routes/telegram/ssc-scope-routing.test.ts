import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  department,
  jobDescription,
  member,
  organization,
  organizationRole,
  resumeSource,
  sscResponsibility,
  studioInterview,
  studioOfferDraft,
  telegramRecipientBinding,
  user,
} from "@arc/db-schema/schema";
import {
  buildSscCandidateVisibilityCondition,
  isSscCandidateVisible,
} from "@arc/ai-recruitment-copilot-backend/server/access/ssc-access";
import {
  completeOfferSscConfirmation,
  loadAuthorizedOfferSscContext,
  receiveOfferSscConfirmation,
} from "../studio/routes/interviews/dao/offer-drafts";
import { getOfferSscNotificationTargets } from "../studio/routes/interviews/utils/offer-ssc-notification";
import { listSourceSscNotificationRecipients } from "./ssc-notification-recipients";

const testDatabaseUrl = process.env.SSC_RESPONSIBILITIES_TEST_DATABASE_URL;
const isolatedDatabase = (() => {
  try {
    return Boolean(
      testDatabaseUrl &&
      testDatabaseUrl === process.env.DATABASE_URL &&
      /^\/ats_ssc_(?:member_contact|scope_routing)_test_\d{8}$/u.test(
        new URL(testDatabaseUrl).pathname,
      ),
    );
  } catch {
    return false;
  }
})();

// Exercise live PostgreSQL queries with independent, randomly named fixtures.
// Telegram transport is never called. DDL is permitted only in the explicit isolated test DB.
describe.skipIf(!isolatedDatabase)("SSC routing follows the candidate's current JD scope", () => {
  let orgId: string;
  let sourceId: string;
  let otherSourceId: string;
  let departmentA: string;
  let departmentB: string;
  let jdId: string;
  let candidateId: string;
  let draftId: string;
  const userIds: string[] = [];
  const chatIds: string[] = [];
  const organizationIds: string[] = [];

  beforeAll(async () => {
    // Existing code can ignore these additional nullable columns, so RED is a
    // wrong recipient/access assertion rather than a missing migration/module.
    await db.execute(
      sql`ALTER TABLE ssc_responsibility ADD COLUMN IF NOT EXISTS service_unit text`,
    );
    await db.execute(
      sql`ALTER TABLE ssc_responsibility ADD COLUMN IF NOT EXISTS department_id text`,
    );
  });

  beforeEach(async () => {
    orgId = `test_ssc_scope_${randomUUID()}`;
    sourceId = randomUUID();
    otherSourceId = randomUUID();
    departmentA = randomUUID();
    departmentB = randomUUID();
    jdId = randomUUID();
    candidateId = randomUUID();
    draftId = randomUUID();
    organizationIds.push(orgId);
    await db.insert(organization).values({ id: orgId, name: "Scope routing", slug: orgId });
    await db.insert(organizationRole).values({
      id: randomUUID(),
      isSsc: true,
      name: "SSC",
      organizationId: orgId,
      permission: JSON.stringify({ offer: ["read", "receive", "confirm"] }),
      role: "scope-ssc",
    });
    await db.insert(resumeSource).values([
      { id: sourceId, name: "Selected center", organizationId: orgId },
      { id: otherSourceId, name: "Another center", organizationId: orgId },
    ]);
    await db.insert(department).values([
      { id: departmentA, name: "Creative", organizationId: orgId },
      { id: departmentB, name: "Engineering", organizationId: orgId },
    ]);
    await db.insert(jobDescription).values({
      departmentId: departmentA,
      id: jdId,
      name: "Selected JD",
      organizationId: orgId,
      prompt: "Scope test",
      resumeSourceId: sourceId,
      serviceUnit: "Studio A",
    });
    await db.insert(studioInterview).values({
      candidateName: "Scope candidate",
      id: candidateId,
      jobDescriptionId: jdId,
      organizationId: orgId,
      pipelineStage: "offer",
    });
    await db.insert(studioOfferDraft).values({
      baseSalary: 15_000,
      id: draftId,
      interviewRecordId: candidateId,
      organizationId: orgId,
      position: "Offer snapshot title",
      recruiterConfirmationStatus: "completed",
      sscConfirmationStatus: "pending",
      sscRevision: 1,
      version: 1,
    });
  });

  afterEach(async () => {
    for (const id of organizationIds.splice(0)) {
      await db.delete(studioInterview).where(eq(studioInterview.organizationId, id));
      await db.delete(jobDescription).where(eq(jobDescription.organizationId, id));
      await db.delete(organization).where(eq(organization.id, id));
    }
    if (userIds.length) {
      await db.delete(user).where(inArray(user.id, userIds.splice(0)));
    }
    if (chatIds.length) {
      await db
        .delete(telegramRecipientBinding)
        .where(inArray(telegramRecipientBinding.chatId, chatIds.splice(0)));
    }
  });

  interface Assignment {
    id: string;
    userId: string;
    chatId: string;
    username: string;
  }
  async function assignment(
    name: string,
    scope: {
      serviceUnit?: string | null;
      departmentId?: string | null;
      sourceId?: string;
      bound?: boolean;
      organizationId?: string;
    } = {},
  ): Promise<Assignment> {
    const id = randomUUID();
    const userId = randomUUID();
    const chatId = String(randomInt(1_000_000, 999_999_999_999));
    const username = `scope_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const assignmentOrg = scope.organizationId ?? orgId;
    userIds.push(userId);
    chatIds.push(chatId);
    await db.insert(user).values({ email: `${userId}@example.test`, id: userId, name });
    await db.insert(member).values({
      id: randomUUID(),
      organizationId: assignmentOrg,
      role: "scope-ssc",
      userId,
    });
    await db.insert(sscResponsibility).values({
      centerName: "Selected center",
      email: `${userId}@example.test`,
      id,
      organizationId: assignmentOrg,
      resumeSourceId: scope.sourceId ?? sourceId,
      sscName: name,
      telegram: `@${username}`,
      workspaceRole: "scope-ssc",
    });
    await db.execute(sql`UPDATE ssc_responsibility
      SET service_unit = ${scope.serviceUnit ?? null}, department_id = ${scope.departmentId ?? null}
      WHERE id = ${id} AND organization_id = ${assignmentOrg}`);
    if (scope.bound !== false) {
      await db.insert(telegramRecipientBinding).values({ chatId, username });
    }
    return { chatId, id, userId, username };
  }
  async function recipients() {
    return await listSourceSscNotificationRecipients({
      interviewRecordId: candidateId,
      organizationId: orgId,
    });
  }
  async function expectRecipients(...expected: Assignment[]) {
    const actual = await recipients();
    expect(actual.map((row) => row.chatId).toSorted()).toEqual(
      expected.map((entry) => entry.chatId).toSorted(),
    );
  }
  async function expectVisibility(entry: Assignment, visible: boolean) {
    const actor = { organizationId: orgId, userId: entry.userId };
    const rows = await db
      .select({ id: studioInterview.id })
      .from(studioInterview)
      .where(and(eq(studioInterview.id, candidateId), buildSscCandidateVisibilityCondition(actor)));
    expect(rows.map((row) => row.id)).toEqual(visible ? [candidateId] : []);
    expect(await isSscCandidateVisible({ actor, candidateId, draftId })).toBe(visible);
  }
  function telegramContext(entry: Assignment) {
    return loadAuthorizedOfferSscContext({
      draftId,
      interviewRecordId: candidateId,
      organizationId: orgId,
      telegramActor: { telegramUserId: entry.chatId, username: entry.username },
    });
  }

  it("sends to an exact service unit and hides the candidate from the generic SSC", async () => {
    const generic = await assignment("Generic");
    const selected = await assignment("Selected unit", { serviceUnit: "  sTuDiO A  " });
    const unrelated = await assignment("Different unit", { serviceUnit: "Studio B" });
    await expectRecipients(selected);
    await expectVisibility(selected, true);
    await expectVisibility(generic, false);
    await expectVisibility(unrelated, false);
  });

  it("uses the department ID rather than a department with the same visible name", async () => {
    await db.update(department).set({ name: "Creative" }).where(eq(department.id, departmentB));
    const generic = await assignment("Generic");
    const selected = await assignment("Selected department", { departmentId: departmentA });
    const other = await assignment("Same name different ID", { departmentId: departmentB });
    await expectRecipients(selected);
    await expectVisibility(generic, false);
    await expectVisibility(other, false);
  });

  it("prefers both dimensions over either one-dimensional assignment", async () => {
    const generic = await assignment("Generic");
    const unit = await assignment("Unit only", { serviceUnit: "Studio A" });
    const departmentOnly = await assignment("Department only", { departmentId: departmentA });
    const exact = await assignment("Exact", { departmentId: departmentA, serviceUnit: "Studio A" });
    await expectRecipients(exact);
    for (const entry of [generic, unit, departmentOnly]) {
      await expectVisibility(entry, false);
    }
    await expectVisibility(exact, true);
  });

  it("requires every filled dimension to match and falls back when none of the finer scopes match", async () => {
    const generic = await assignment("Generic");
    const wrongDepartment = await assignment("Wrong department", {
      departmentId: departmentB,
      serviceUnit: "Studio A",
    });
    const wrongUnit = await assignment("Wrong unit", {
      departmentId: departmentA,
      serviceUnit: "Studio B",
    });
    await expectRecipients(generic);
    await expectVisibility(generic, true);
    await expectVisibility(wrongDepartment, false);
    await expectVisibility(wrongUnit, false);
  });

  it("keeps every equally specific matching SSC instead of choosing a dimension or actor first", async () => {
    const generic = await assignment("Generic");
    const unit = await assignment("Unit", { serviceUnit: "Studio A" });
    const departmentOnly = await assignment("Department", { departmentId: departmentA });
    await expectRecipients(unit, departmentOnly);
    await expectVisibility(unit, true);
    await expectVisibility(departmentOnly, true);
    await expectVisibility(generic, false);
  });

  it("deduplicates a verified chat shared by two equally specific selected ledger entries", async () => {
    await assignment("Generic");
    const unit = await assignment("Unit", { serviceUnit: "Studio A" });
    const departmentOnly = await assignment("Department", { departmentId: departmentA });
    await db
      .update(sscResponsibility)
      .set({ telegram: `@${unit.username}` })
      .where(eq(sscResponsibility.id, departmentOnly.id));
    await expectRecipients(unit);
  });

  it("refuses a generic SSC's TG action even though that chat is verified and the Offer ID is valid", async () => {
    const generic = await assignment("Generic");
    await assignment("Selected", { serviceUnit: "Studio A" });
    await expect(telegramContext(generic)).rejects.toMatchObject({ status: 403 });
  });

  it("does not fall back to a bound generic SSC when the selected finer SSC has not followed TG", async () => {
    const generic = await assignment("Bound generic");
    const selected = await assignment("Unbound exact", {
      bound: false,
      departmentId: departmentA,
      serviceUnit: "Studio A",
    });
    await expectRecipients();
    await expectVisibility(selected, true);
    await expectVisibility(generic, false);
    await expect(telegramContext(generic)).rejects.toMatchObject({ status: 403 });
  });

  it("does not restore generic visibility when the finer assignee loses its membership", async () => {
    const generic = await assignment("Generic");
    const selected = await assignment("Removed assignee", { serviceUnit: "Studio A" });
    await db.delete(member).where(eq(member.userId, selected.userId));
    await expectVisibility(selected, false);
    await expectVisibility(generic, false);
  });

  it("treats an empty service scope as unrestricted rather than an extra specificity point", async () => {
    const blank = await assignment("Department with blank unit", {
      departmentId: departmentA,
      serviceUnit: "   ",
    });
    const unit = await assignment("Unit", { serviceUnit: "Studio A" });
    await expectRecipients(blank, unit);
  });

  it("uses a complete normalized service-unit match rather than prefix or substring matching", async () => {
    const generic = await assignment("Generic");
    const prefix = await assignment("Prefix", { serviceUnit: "Studio" });
    const longer = await assignment("Longer", { serviceUnit: "Studio A East" });
    await expectRecipients(generic);
    await expectVisibility(prefix, false);
    await expectVisibility(longer, false);
  });

  it("does not let matching dimensions from another resume source outrank this source's generic SSC", async () => {
    const generic = await assignment("Current center");
    const other = await assignment("Other center exact", {
      departmentId: departmentA,
      serviceUnit: "Studio A",
      sourceId: otherSourceId,
    });
    await expectRecipients(generic);
    await expectVisibility(generic, true);
    await expectVisibility(other, false);
  });

  it("keeps tenant isolation even when another workspace has matching source and scope names", async () => {
    const generic = await assignment("Current workspace");
    const foreignOrg = `test_ssc_scope_${randomUUID()}`;
    const foreignSource = randomUUID();
    const foreignDepartment = randomUUID();
    organizationIds.push(foreignOrg);
    await db.insert(organization).values({ id: foreignOrg, name: "Foreign", slug: foreignOrg });
    await db.insert(organizationRole).values({
      id: randomUUID(),
      isSsc: true,
      name: "SSC",
      organizationId: foreignOrg,
      permission: JSON.stringify({ offer: ["read", "receive", "confirm"] }),
      role: "scope-ssc",
    });
    await db
      .insert(resumeSource)
      .values({ id: foreignSource, name: "Selected center", organizationId: foreignOrg });
    await db
      .insert(department)
      .values({ id: foreignDepartment, name: "Creative", organizationId: foreignOrg });
    const foreign = await assignment("Foreign exact", {
      departmentId: foreignDepartment,
      organizationId: foreignOrg,
      serviceUnit: "Studio A",
      sourceId: foreignSource,
    });
    await expectRecipients(generic);
    await expectVisibility(foreign, false);
    expect(
      await listSourceSscNotificationRecipients({
        interviewRecordId: candidateId,
        organizationId: foreignOrg,
      }),
    ).toEqual([]);
    expect(
      await isSscCandidateVisible({
        actor: { organizationId: foreignOrg, userId: foreign.userId },
        candidateId,
        draftId,
      }),
    ).toBe(false);
  });

  it.each([null, "   "])(
    "uses the generic assignment when the JD has no service unit (%s)",
    async (serviceUnit) => {
      await db.update(jobDescription).set({ serviceUnit }).where(eq(jobDescription.id, jdId));
      const generic = await assignment("Generic");
      const unit = await assignment("Unit", { serviceUnit: "Studio A" });
      await expectRecipients(generic);
      await expectVisibility(generic, true);
      await expectVisibility(unit, false);
    },
  );

  it("returns no recipients or visibility when the candidate has not selected a JD", async () => {
    const generic = await assignment("Generic");
    await db
      .update(studioInterview)
      .set({ jobDescriptionId: null })
      .where(eq(studioInterview.id, candidateId));
    await expectRecipients();
    await expectVisibility(generic, false);
  });

  it("reauthorizes an old TG card after editing the JD instead of trusting its original recipient", async () => {
    const old = await assignment("Old exact", {
      departmentId: departmentA,
      serviceUnit: "Studio A",
    });
    const next = await assignment("New exact", {
      departmentId: departmentB,
      serviceUnit: "Studio B",
    });
    const before = await telegramContext(old);
    expect(before.canReceive).toBe(true);
    await db
      .update(jobDescription)
      .set({ departmentId: departmentB, serviceUnit: "Studio B" })
      .where(eq(jobDescription.id, jdId));
    await expect(telegramContext(old)).rejects.toMatchObject({ status: 403 });
    await expectRecipients(next);
    const after = await telegramContext(next);
    expect(after.canReceive).toBe(true);
    await expectVisibility(old, false);
    await expectVisibility(next, true);
  });

  it("reauthorizes an old TG card after editing SSC responsibility back to a different scope", async () => {
    const generic = await assignment("Generic");
    const old = await assignment("Old selected", { departmentId: departmentA });
    const before = await telegramContext(old);
    expect(before.canReceive).toBe(true);
    await db.execute(
      sql`UPDATE ssc_responsibility SET department_id = ${departmentB} WHERE id = ${old.id}`,
    );
    await expect(telegramContext(old)).rejects.toMatchObject({ status: 403 });
    await expectRecipients(generic);
    await expectVisibility(old, false);
    await expectVisibility(generic, true);
  });

  it("routes by a newly selected JD while retaining the same candidate and Offer version", async () => {
    const old = await assignment("First JD", {
      departmentId: departmentA,
      serviceUnit: "Studio A",
    });
    const next = await assignment("New JD", { departmentId: departmentB, serviceUnit: "Studio B" });
    const nextJd = randomUUID();
    await db.insert(jobDescription).values({
      departmentId: departmentB,
      id: nextJd,
      name: "New selected JD",
      organizationId: orgId,
      prompt: "Scope test",
      resumeSourceId: sourceId,
      serviceUnit: "Studio B",
    });
    const before = await telegramContext(old);
    expect(before.canReceive).toBe(true);
    await db
      .update(studioInterview)
      .set({ jobDescriptionId: nextJd })
      .where(eq(studioInterview.id, candidateId));
    await expect(telegramContext(old)).rejects.toMatchObject({ status: 403 });
    await expectRecipients(next);
    await expectVisibility(next, true);
    await expectVisibility(old, false);
  });

  it("reads the selected current JD rather than the saved Offer confirmation text", async () => {
    const selected = await assignment("Current JD", {
      departmentId: departmentA,
      serviceUnit: "Studio A",
    });
    const snapshot = await assignment("Old snapshot", {
      departmentId: departmentB,
      serviceUnit: "Studio B",
    });
    await db.execute(
      sql`UPDATE studio_offer_draft SET confirmation_info = ${JSON.stringify({ department: "Engineering", serviceUnit: "Studio B" })}::jsonb WHERE id = ${draftId}`,
    );
    await expectRecipients(selected);
    await expectVisibility(snapshot, false);
  });

  it("retains receive and complete confirmation after the recruiter gate with the selected SSC", async () => {
    const generic = await assignment("Generic");
    const selected = await assignment("Selected SSC", { serviceUnit: "Studio A" });
    const targets = await getOfferSscNotificationTargets({
      draftId,
      event: "pending",
      interviewRecordId: candidateId,
      organizationId: orgId,
      revision: 1,
    });
    expect(targets.map((target) => target.chatId)).toEqual([selected.chatId]);
    const input = {
      actor: { telegramUserId: selected.chatId, username: selected.username },
      draftId,
      interviewRecordId: candidateId,
      organizationId: orgId,
      revision: 1,
      source: "telegram" as const,
    };
    const received = await receiveOfferSscConfirmation(input);
    expect(received.sscConfirmationStatus).toBe("confirming");
    const completed = await completeOfferSscConfirmation({
      ...input,
      internalApprovalConfirmed: true,
    });
    expect(completed.sscConfirmationStatus).toBe("completed");
    await expectVisibility(selected, true);
    await expectVisibility(generic, false);
  });

  it("keeps the recruiter contact gate before sending or accepting an SSC action", async () => {
    const selected = await assignment("Selected SSC", { serviceUnit: "Studio A" });
    await db
      .update(studioOfferDraft)
      .set({ recruiterConfirmationStatus: "pending" })
      .where(eq(studioOfferDraft.id, draftId));
    const targets = await getOfferSscNotificationTargets({
      draftId,
      event: "pending",
      interviewRecordId: candidateId,
      organizationId: orgId,
      revision: 1,
    });
    expect(targets).toEqual([]);
    const context = await telegramContext(selected);
    expect(context.canReceive).toBe(false);
    await expect(
      receiveOfferSscConfirmation({
        actor: { telegramUserId: selected.chatId, username: selected.username },
        draftId,
        interviewRecordId: candidateId,
        organizationId: orgId,
        revision: 1,
        source: "telegram",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
