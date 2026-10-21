import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { studioOfferDraft } from "@arc/db-schema/schema";
import { offerDraftInputSchema } from "@arc/db-schema/studio-interviews";
import { createOfferDraft, editOfferDraft } from "./offer-drafts";

const mocks = vi.hoisted(() => ({
  database: null as unknown,
  deleteObject: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  get db() {
    return mocks.database;
  },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  deleteObject: mocks.deleteObject,
}));
vi.mock("./offer-ssc-notification-outbox", () => ({ enqueueOfferSscNotification: mocks.enqueue }));
vi.mock("./human-interview-rounds", () => ({
  getHumanInterviewOfferReadinessError: vi.fn(),
  loadHumanInterviewRoundReadiness: vi.fn(),
}));
vi.mock("../utils/candidate-stage-notification", () => ({ notifyCandidateStageChange: vi.fn() }));
vi.mock("../utils/candidate-activity", () => ({ recordCandidateActivityInTransaction: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-permission-snapshot", () => ({
  computeWorkspacePermissionSnapshot: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/resume-visibility", () => ({
  buildResumeVisibilityCondition: vi.fn(),
  resolveResumeVisibilityScope: vi.fn(),
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/telegram/ssc-notification-recipients",
  () => ({ listSourceSscNotificationRecipients: vi.fn() }),
);

const client = new PGlite();
const database = drizzle({ client });
const candidateId = "confirmation-candidate";
const organizationId = "confirmation-org";
const confirmation = {
  candidateName: "候选人",
  interviewFeedback: "能独立交付",
  probationPeriod: "3个月",
  probationSalary: 10_000,
};

beforeAll(async () => {
  mocks.database = database;
  await client.exec(
    "CREATE TABLE studio_interview (id text PRIMARY KEY, organization_id text, pipeline_stage text)",
  );
  const defaults: Record<string, string> = {
    created_at: "DEFAULT CURRENT_TIMESTAMP",
    currency: "DEFAULT 'CNY'",
    ssc_revision: "DEFAULT 1",
    status: "DEFAULT 'draft'",
    updated_at: "DEFAULT CURRENT_TIMESTAMP",
  };
  const columns = getTableConfig(studioOfferDraft)
    .columns.map(
      (column) =>
        `"${column.name}" ${column.getSQLType()} ${column.notNull ? "NOT NULL" : ""} ${defaults[column.name] ?? ""}`,
    )
    .join(", ");
  await client.exec(
    `CREATE TABLE studio_offer_draft (${columns}, PRIMARY KEY (id), UNIQUE (interview_record_id, version))`,
  );
});
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await client.exec("TRUNCATE studio_offer_draft, studio_interview");
  await client.query("INSERT INTO studio_interview VALUES ($1, $2, 'offer')", [
    candidateId,
    organizationId,
  ]);
});

async function create() {
  return await createOfferDraft({
    input: offerDraftInputSchema.parse({
      baseSalary: 12_000,
      confirmationInfo: confirmation,
      currency: "USD",
      position: "工程师",
    }),
    interviewRecordId: candidateId,
    organizationId,
  });
}

describe("Offer confirmation version snapshots", () => {
  it("persists and returns the confirmed content in the same pending Offer transaction", async () => {
    const created = await create();
    expect(created).toHaveProperty("confirmationInfo", expect.objectContaining(confirmation));
    const [stored] = await database
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, created.id));
    expect(stored).toHaveProperty("confirmationInfo", expect.objectContaining(confirmation));
    expect(stored).toMatchObject({
      sscConfirmationStatus: "pending",
      sscRevision: 1,
      status: "draft",
    });
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ draftId: created.id, event: "pending", revision: 1 }),
    );
  });

  it("preserves the stored snapshot when an older client omits it in a patch", async () => {
    const created = await create();
    const edited = await editOfferDraft({
      draftId: created.id,
      input: { notes: "只改备注" },
      organizationId,
    });
    expect(edited).toHaveProperty("confirmationInfo", expect.objectContaining(confirmation));
  });

  it("preserves hidden historical terms exactly when the editable snapshot is updated", async () => {
    const created = await create();
    const legacyTerms = {
      bonus: 0,
      equity: "  历史期权\n尾行  ",
      joiningDate: new Date("2026-12-01T08:42:17.000Z"),
      notes: "  历史备注\n  缩进尾行  ",
    };
    await database
      .update(studioOfferDraft)
      .set(legacyTerms)
      .where(eq(studioOfferDraft.id, created.id));
    const input = offerDraftInputSchema.partial().parse({
      confirmationInfo: { ...confirmation, probationPeriod: "2个月", probationSalary: 0 },
    });
    const edited = await editOfferDraft({ draftId: created.id, input, organizationId });
    expect(edited).toMatchObject({
      ...legacyTerms,
      confirmationInfo: expect.objectContaining({ probationPeriod: "2个月", probationSalary: 0 }),
      joiningDate: legacyTerms.joiningDate.toISOString(),
    });
    const [stored] = await database
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, created.id));
    expect(stored).toMatchObject(legacyTerms);
  });

  it("invalidates completed SSC confirmation and its evidence when snapshot content changes", async () => {
    const created = await create();
    await database
      .update(studioOfferDraft)
      .set({
        sscCompletedAt: new Date(),
        sscCompletedBy: "ssc",
        sscCompletionAttachment: {
          filename: "approved.png",
          mediaType: "image/png",
          revision: 1,
          size: 20,
          storageKey: "old-proof",
        },
        sscConfirmationStatus: "completed",
        sscReceivedAt: new Date(),
        sscReceivedBy: "ssc",
      })
      .where(eq(studioOfferDraft.id, created.id));
    const input = offerDraftInputSchema
      .partial()
      .parse({ confirmationInfo: { ...confirmation, departmentName: "调整后部门" } });
    const edited = await editOfferDraft({ draftId: created.id, input, organizationId });
    expect(edited).toMatchObject({
      confirmationInfo: expect.objectContaining({ departmentName: "调整后部门" }),
      sscCompletedAt: null,
      sscCompletedBy: null,
      sscCompletionAttachment: null,
      sscConfirmationStatus: "pending",
      sscReceivedAt: null,
      sscReceivedBy: null,
      sscRevision: 2,
    });
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith("old-proof");
  });

  it("keeps completed confirmation for an equal JSON snapshot despite JSONB key ordering", async () => {
    const created = await create();
    await database
      .update(studioOfferDraft)
      .set({ sscCompletedAt: new Date(), sscConfirmationStatus: "completed" })
      .where(eq(studioOfferDraft.id, created.id));
    const input = offerDraftInputSchema.partial().parse({ confirmationInfo: confirmation });
    const edited = await editOfferDraft({ draftId: created.id, input, organizationId });
    expect(edited).toMatchObject({ sscConfirmationStatus: "completed", sscRevision: 1 });
    expect(edited.sscCompletedAt).not.toBeNull();
  });
});
