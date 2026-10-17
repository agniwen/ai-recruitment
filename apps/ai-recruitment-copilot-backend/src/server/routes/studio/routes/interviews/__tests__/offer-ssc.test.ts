import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  buildOfferApprovalAttachmentKey,
  getObjectStream,
  putObjectBytes,
} from "@arc/ai-recruitment-copilot-backend/lib/server/s3";
import { interviewAuditLog, studioInterview, studioOfferDraft } from "@arc/db-schema/schema";
import {
  completeOfferSscConfirmation,
  createOfferDraft,
  editOfferDraft,
  editOfferDraftWithAttachment,
  removeOfferApprovalAttachment,
  sendOfferDraft,
} from "../dao/offer-drafts";
import {
  CANDIDATE,
  CONFIRM_ONLY_SSC,
  FIRST_SSC,
  FORBIDDEN_USER,
  INPUT,
  ORG,
  RECEIVE_ONLY_SSC,
  SECOND_SSC,
  makeApp,
  newOffer,
  requestAction,
  setupOfferSscFixture,
} from "./offer-ssc-fixture";

const notificationMocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("../dao/offer-ssc-notification-outbox", () => ({
  enqueueOfferSscNotification: notificationMocks.enqueue,
}));

// The real DAO, permission snapshot and database stay in this suite. Only external
// delivery/storage and the request middleware are replaced; the shared SSC action
// must enforce current membership and permissions even without HTTP middleware.
vi.mock("@arc/ai-recruitment-copilot-backend/server/middlewares/permission", () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => await next(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  buildOfferApprovalAttachmentKey: vi.fn(),
  deleteObject: vi.fn(),
  getObjectStream: vi.fn(),
  putObjectBytes: vi.fn(),
}));
vi.mock("../utils/candidate-stage-notification", () => ({
  notifyCandidateStageChange: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/cache-tags", () => ({
  invalidateStudioInterviewCaches: vi.fn(),
  safeUpdateTag: vi.fn(),
}));

setupOfferSscFixture();
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  notificationMocks.enqueue.mockReset().mockImplementation(() => Promise.resolve());
  await db.delete(interviewAuditLog).where(eq(interviewAuditLog.organizationId, ORG));
  await db.delete(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG));
  await db
    .update(studioInterview)
    .set({ createdBy: FIRST_SSC, outcome: "in_pipeline", pipelineStage: "offer" })
    .where(eq(studioInterview.id, CANDIDATE));
});

describe("Offer SSC notification events", () => {
  it("enqueues pending after inserting a new Offer in the same transaction", async () => {
    const offer = await newOffer();
    expect(notificationMocks.enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      draftId: offer.id,
      event: "pending",
      interviewRecordId: CANDIDATE,
      organizationId: ORG,
      revision: 1,
    });
  });

  it.each(["receive", "complete"] as const)(
    "enqueues %s only on the first transition",
    async (action) => {
      const offer = await newOffer();
      if (action === "complete") {
        await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 200);
      }
      notificationMocks.enqueue.mockClear();
      await expect(requestAction(offer.id, action)).resolves.toHaveProperty("status", 200);
      await expect(requestAction(offer.id, action, 1, SECOND_SSC)).resolves.toHaveProperty(
        "status",
        200,
      );
      expect(notificationMocks.enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        draftId: offer.id,
        event: action === "receive" ? "received" : "completed",
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        revision: 1,
      });
    },
  );

  it("enqueues a fresh revision for changed terms but not an unchanged save", async () => {
    const offer = await newOffer();
    notificationMocks.enqueue.mockClear();
    await editOfferDraft({ draftId: offer.id, input: { baseSalary: 35_000 }, organizationId: ORG });
    await editOfferDraft({ draftId: offer.id, input: { baseSalary: 35_000 }, organizationId: ORG });
    expect(notificationMocks.enqueue).toHaveBeenCalledTimes(1);
    expect(notificationMocks.enqueue).toHaveBeenLastCalledWith(expect.anything(), {
      draftId: offer.id,
      event: "pending",
      interviewRecordId: CANDIDATE,
      organizationId: ORG,
      revision: 2,
    });
  });

  it("enqueues pending for review attachment replacement and removal, not a missing attachment", async () => {
    const offer = await newOffer();
    notificationMocks.enqueue.mockClear();
    await editOfferDraftWithAttachment({
      approvalAttachment: {
        filename: "review.png",
        mediaType: "image/png",
        size: 3,
        storageKey: "ssc/review.png",
      },
      draftId: offer.id,
      input: {},
      organizationId: ORG,
    });
    await removeOfferApprovalAttachment(offer.id, CANDIDATE, ORG);
    await removeOfferApprovalAttachment(offer.id, CANDIDATE, ORG);
    expect(notificationMocks.enqueue.mock.calls.map((call) => call[1])).toEqual([
      {
        draftId: offer.id,
        event: "pending",
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        revision: 2,
      },
      {
        draftId: offer.id,
        event: "pending",
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        revision: 3,
      },
    ]);
  });

  it("does not enqueue historical NULL Offer edits", async () => {
    const offer = await newOffer();
    await db
      .update(studioOfferDraft)
      .set({ sscConfirmationStatus: null })
      .where(eq(studioOfferDraft.id, offer.id));
    notificationMocks.enqueue.mockClear();
    await editOfferDraft({ draftId: offer.id, input: { baseSalary: 35_000 }, organizationId: ORG });
    expect(notificationMocks.enqueue).not.toHaveBeenCalled();
  });

  it("rolls back Offer creation if its durable event cannot be saved", async () => {
    notificationMocks.enqueue.mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(newOffer()).rejects.toThrow("outbox unavailable");
    expect(
      await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG)),
    ).toHaveLength(0);
  });

  it("rolls back changed terms when the corresponding notification event fails", async () => {
    const offer = await newOffer();
    notificationMocks.enqueue.mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(
      editOfferDraft({ draftId: offer.id, input: { baseSalary: 35_000 }, organizationId: ORG }),
    ).rejects.toThrow("outbox unavailable");
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored).toMatchObject({
      baseSalary: 30_000,
      sscConfirmationStatus: "pending",
      sscRevision: 1,
    });
  });
});

describe("current Offer SSC state", () => {
  const path = `/${CANDIDATE}/offer-drafts/ssc/current`;

  it("returns only the SSC summary to a custom role with Offer read access", async () => {
    const offer = await newOffer();
    await db
      .update(studioOfferDraft)
      .set({
        approvalAttachment: {
          filename: "private-review.pdf",
          mediaType: "application/pdf",
          size: 10,
          storageKey: "private/ssc-review.pdf",
        },
        notes: "private negotiation notes",
      })
      .where(eq(studioOfferDraft.id, offer.id));

    const response = await makeApp(RECEIVE_ONLY_SSC).request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: offer.id,
      sscConfirmationStatus: "pending",
      status: "draft",
      version: 1,
    });
  });

  it.each(["deleted", "superseded"] as const)(
    "keeps a newer %s version instead of falling back to an accepted confirmed Offer",
    async (status) => {
      const accepted = await newOffer();
      await db
        .update(studioOfferDraft)
        .set({ sscConfirmationStatus: "completed", status: "accepted" })
        .where(eq(studioOfferDraft.id, accepted.id));
      const latest = await newOffer();
      await db.update(studioOfferDraft).set({ status }).where(eq(studioOfferDraft.id, latest.id));

      const response = await makeApp().request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: latest.id,
        sscConfirmationStatus: "pending",
        status,
        version: 2,
      });
    },
  );

  it("returns null when an authorized visible candidate has no Offer", async () => {
    const response = await makeApp(RECEIVE_ONLY_SSC).request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it.each([false, true])(
    "checks actual Offer read permission when an Offer exists: %s",
    async (exists) => {
      if (exists) {
        await newOffer();
      }
      await expect(makeApp(FORBIDDEN_USER).request(path)).resolves.toHaveProperty("status", 403);
    },
  );

  it("hides the SSC state when the reader cannot see the candidate", async () => {
    await newOffer();
    await db
      .update(studioInterview)
      .set({ createdBy: SECOND_SSC })
      .where(eq(studioInterview.id, CANDIDATE));
    await expect(makeApp(RECEIVE_ONLY_SSC).request(path)).resolves.toHaveProperty("status", 404);
  });

  it("does not treat a missing candidate as an empty Offer history", async () => {
    await expect(
      makeApp().request("/missing-candidate/offer-drafts/ssc/current"),
    ).resolves.toHaveProperty("status", 404);
  });
});

describe("Offer SSC confirmation", () => {
  it("requires an explicit internal approval declaration before completion", async () => {
    const offer = await newOffer();
    await requestAction(offer.id, "receive");
    for (const internalApprovalConfirmed of [undefined, false]) {
      const response = await makeApp().request(
        `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/complete`,
        {
          body: JSON.stringify({ internalApprovalConfirmed, revision: 1 }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(response.status).toBe(400);
    }
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored.sscConfirmationStatus).toBe("confirming");
  });

  it("enforces the internal approval declaration inside the shared DAO", async () => {
    const offer = await newOffer();
    await requestAction(offer.id, "receive");
    await expect(
      completeOfferSscConfirmation({
        actor: { id: FIRST_SSC, role: "owner" },
        draftId: offer.id,
        internalApprovalConfirmed: false,
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        revision: 1,
      } as never),
    ).rejects.toThrow("内部审批");
  });

  it("stores completion proof separately, strips storage keys, and preserves the first completion", async () => {
    const offer = await newOffer();
    await requestAction(offer.id, "receive");
    const completionAttachment = {
      filename: "approved.png",
      mediaType: "image/png",
      revision: 1,
      size: 68,
      storageKey: "private/first.png",
    };
    const input = {
      actor: { id: FIRST_SSC, role: "owner" },
      completionAttachment,
      draftId: offer.id,
      internalApprovalConfirmed: true,
      interviewRecordId: CANDIDATE,
      organizationId: ORG,
      revision: 1,
    };
    const completed = await completeOfferSscConfirmation(input as never);
    expect(completed).toHaveProperty("sscCompletionAttachment", {
      filename: "approved.png",
      mediaType: "image/png",
      revision: 1,
      size: 68,
    });
    expect(JSON.stringify(completed)).not.toContain("private/first.png");
    const repeated = await completeOfferSscConfirmation({
      ...input,
      completionAttachment: {
        ...completionAttachment,
        filename: "other.png",
        storageKey: "private/other.png",
      },
    } as never);
    expect(repeated).toEqual(completed);
    const [activity] = await db
      .select()
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.action, "offer_ssc_completed"));
    expect(activity.detail).toMatchObject({
      hasApprovalScreenshot: true,
      internalApprovalConfirmed: true,
    });
    expect(JSON.stringify(activity.detail)).not.toContain("private/first.png");
    const edited = await editOfferDraft({
      draftId: offer.id,
      input: { baseSalary: 33_000 },
      organizationId: ORG,
    });
    expect(edited).toMatchObject({
      sscCompletionAttachment: null,
      sscConfirmationStatus: "pending",
      sscRevision: 2,
    });
  });

  it("rejects completion proof belonging to an older revision", async () => {
    const offer = await newOffer();
    await requestAction(offer.id, "receive");
    await expect(
      completeOfferSscConfirmation({
        actor: { id: FIRST_SSC, role: "owner" },
        completionAttachment: {
          filename: "approved.png",
          mediaType: "image/png",
          revision: 2,
          size: 68,
          storageKey: "private/proof.png",
        },
        draftId: offer.id,
        internalApprovalConfirmed: true,
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        revision: 1,
      } as never),
    ).rejects.toThrow();
  });

  it("streams completion proof privately only for its authorized candidate and current revision", async () => {
    const offer = await newOffer();
    await requestAction(offer.id, "receive");
    await completeOfferSscConfirmation({
      actor: { id: FIRST_SSC, role: "owner" },
      completionAttachment: {
        filename: "approved.png",
        mediaType: "image/png",
        revision: 1,
        size: 5,
        storageKey: "private/proof.png",
      },
      draftId: offer.id,
      internalApprovalConfirmed: true,
      interviewRecordId: CANDIDATE,
      organizationId: ORG,
      revision: 1,
    } as never);
    vi.mocked(getObjectStream).mockResolvedValue({ body: "proof" as never, contentLength: 5 });
    const path = `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/completion-attachment`;
    const response = await makeApp().request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("proof");
    const forbidden = await makeApp(FORBIDDEN_USER).request(path);
    expect(forbidden.status).toBe(403);
    const wrongCandidate = await makeApp().request(
      `/other-candidate/offer-drafts/${offer.id}/ssc/completion-attachment`,
    );
    expect(wrongCandidate.status).toBe(404);
    await editOfferDraft({ draftId: offer.id, input: { baseSalary: 32_000 }, organizationId: ORG });
    const stale = await makeApp().request(path);
    expect(stale.status).toBe(404);
  });

  it.each([false, true])(
    "supports optional screenshots through the multipart completion endpoint: %s",
    async (withScreenshot) => {
      const offer = await newOffer();
      await requestAction(offer.id, "receive");
      vi.mocked(buildOfferApprovalAttachmentKey).mockResolvedValue("private/multipart.png");
      const form = new FormData();
      form.set("revision", "1");
      form.set("internalApprovalConfirmed", "true");
      if (withScreenshot) {
        form.set(
          "file",
          new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "approved.png", {
            type: "image/png",
          }),
        );
      }
      const response = await makeApp().request(
        `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/complete-with-attachment`,
        { body: form, method: "POST" },
      );
      expect(response.status).toBe(200);
      const completed = await response.json();
      expect(completed.sscConfirmationStatus).toBe("completed");
      expect(completed.sscCompletionAttachment).toEqual(
        withScreenshot
          ? { filename: "approved.png", mediaType: "image/png", revision: 1, size: 8 }
          : null,
      );
      expect(JSON.stringify(completed)).not.toContain("private/multipart.png");
    },
  );

  it.each(["false", "duplicate", "invalid"])(
    "rejects invalid multipart completion input without storing screenshots: %s",
    async (mode) => {
      const offer = await newOffer();
      await requestAction(offer.id, "receive");
      vi.mocked(putObjectBytes).mockClear();
      const form = new FormData();
      form.set("revision", "1");
      form.set("internalApprovalConfirmed", mode === "false" ? "false" : "true");
      form.append("file", new File(["fake PNG"], "approved.png", { type: "image/png" }));
      if (mode === "duplicate") {
        form.append("file", new File(["second"], "second.png", { type: "image/png" }));
      }
      const response = await makeApp().request(
        `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/complete-with-attachment`,
        { body: form, method: "POST" },
      );
      expect(response.status).toBe(400);
      expect(putObjectBytes).not.toHaveBeenCalled();
      const [stored] = await db
        .select()
        .from(studioOfferDraft)
        .where(eq(studioOfferDraft.id, offer.id));
      expect(stored.sscConfirmationStatus).toBe("confirming");
    },
  );

  it("creates a pending internal Offer", async () => {
    const offer = await newOffer();
    expect(offer).toMatchObject({
      sscConfirmationStatus: "pending",
      sscRevision: 1,
      status: "draft",
    });
  });

  it("cannot create an Offer already sent", async () => {
    await expect(
      createOfferDraft({
        input: INPUT,
        interviewRecordId: CANDIDATE,
        organizationId: ORG,
        sendImmediately: true,
      }),
    ).rejects.toThrow();
    expect(
      await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG)),
    ).toHaveLength(0);
  });

  it("does not create an Offer for a candidate that closed before the DAO lock", async () => {
    await db
      .update(studioInterview)
      .set({ outcome: "withdrawn", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    await expect(newOffer()).rejects.toThrow();
    expect(
      await db.select().from(studioOfferDraft).where(eq(studioOfferDraft.organizationId, ORG)),
    ).toHaveLength(0);
  });

  it.each(["pending", "confirming"] as const)(
    "cannot send an Offer while SSC is %s",
    async (sscConfirmationStatus) => {
      const offer = await newOffer();
      await db
        .update(studioOfferDraft)
        .set({ sscConfirmationStatus })
        .where(eq(studioOfferDraft.id, offer.id));
      await expect(sendOfferDraft(offer.id, ORG)).rejects.toThrow();
      const [stored] = await db
        .select()
        .from(studioOfferDraft)
        .where(eq(studioOfferDraft.id, offer.id));
      expect(stored?.status).toBe("draft");
      expect(stored?.sentAt).toBeNull();
    },
  );

  it("allows a different SSC to finish after the first SSC receives, then permits sending", async () => {
    const offer = await newOffer();
    const received = await requestAction(offer.id, "receive");
    expect(received.status).toBe(200);
    expect(await received.json()).toMatchObject({
      sscConfirmationStatus: "confirming",
      sscReceivedBy: FIRST_SSC,
    });
    const completed = await requestAction(offer.id, "complete", 1, SECOND_SSC);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      sscCompletedBy: SECOND_SSC,
      sscConfirmationStatus: "completed",
    });
    expect(await sendOfferDraft(offer.id, ORG)).toMatchObject({ status: "sent" });
  });

  it("does not allow completion before receipt", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "complete")).resolves.toHaveProperty("status", 409);
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored?.sscConfirmationStatus).toBe("pending");
  });

  it("keeps the first receiver and completion facts on repeated actions", async () => {
    const offer = await newOffer();
    const first = await requestAction(offer.id, "receive");
    expect(first.status).toBe(200);
    const received = await first.json();
    const repeated = await requestAction(offer.id, "receive", 1, SECOND_SSC);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      sscReceivedAt: received.sscReceivedAt,
      sscReceivedBy: FIRST_SSC,
    });
    const completed = await requestAction(offer.id, "complete", 1, SECOND_SSC);
    expect(completed.status).toBe(200);
    const completion = await completed.json();
    const repeatedCompletion = await requestAction(offer.id, "complete", 1, FIRST_SSC);
    expect(repeatedCompletion.status).toBe(200);
    expect(await repeatedCompletion.json()).toMatchObject({
      sscCompletedAt: completion.sscCompletedAt,
      sscCompletedBy: SECOND_SSC,
    });
    const activity = await db
      .select({ action: interviewAuditLog.action })
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.organizationId, ORG))
      .orderBy(interviewAuditLog.createdAt);
    expect(activity.map((entry) => entry.action)).toEqual([
      "offer_ssc_received",
      "offer_ssc_completed",
    ]);
  });

  it("serializes concurrent receipts so exactly one receiver is recorded", async () => {
    const offer = await newOffer();
    const results = await Promise.all([
      requestAction(offer.id, "receive", 1, FIRST_SSC),
      requestAction(offer.id, "receive", 1, SECOND_SSC),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const records = await Promise.all(results.map((result) => result.json()));
    expect(records[0].sscReceivedBy).toBe(records[1].sscReceivedBy);
    expect([FIRST_SSC, SECOND_SSC]).toContain(records[0].sscReceivedBy);
  });

  it("resets completed confirmation on changed terms and rejects stale buttons", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 200);
    await expect(requestAction(offer.id, "complete")).resolves.toHaveProperty("status", 200);
    const updated = await editOfferDraft({
      draftId: offer.id,
      input: { baseSalary: 35_000 },
      organizationId: ORG,
    });
    expect(updated).toMatchObject({
      sscCompletedAt: null,
      sscCompletedBy: null,
      sscConfirmationStatus: "pending",
      sscReceivedAt: null,
      sscReceivedBy: null,
      sscRevision: 2,
    });
    await expect(requestAction(offer.id, "receive", 1)).resolves.toHaveProperty("status", 409);
    await expect(requestAction(offer.id, "complete", 1)).resolves.toHaveProperty("status", 409);
    await expect(requestAction(offer.id, "receive", 2)).resolves.toHaveProperty("status", 200);
  });

  it("does not reset confirmation for an unchanged save", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 200);
    const unchanged = await editOfferDraft({
      draftId: offer.id,
      input: INPUT,
      organizationId: ORG,
    });
    expect(unchanged).toMatchObject({
      sscConfirmationStatus: "confirming",
      sscReceivedBy: FIRST_SSC,
      sscRevision: 1,
    });
  });

  it("invalidates confirmation when the review attachment is removed", async () => {
    const offer = await newOffer();
    await editOfferDraftWithAttachment({
      approvalAttachment: {
        filename: "review.png",
        mediaType: "image/png",
        size: 3,
        storageKey: "ssc/review.png",
      },
      draftId: offer.id,
      input: {},
      organizationId: ORG,
    });
    await expect(requestAction(offer.id, "receive", 2)).resolves.toHaveProperty("status", 200);
    await expect(requestAction(offer.id, "complete", 2)).resolves.toHaveProperty("status", 200);
    await removeOfferApprovalAttachment(offer.id, CANDIDATE, ORG);
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored).toMatchObject({
      approvalAttachment: null,
      sscConfirmationStatus: "pending",
      sscRevision: 3,
    });
  });

  it("checks the actual member permission even when HTTP middleware was bypassed", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive", 1, FORBIDDEN_USER)).resolves.toHaveProperty(
      "status",
      403,
    );
  });

  it("allows the custom receive-only role to receive but never complete confirmation", async () => {
    const offer = await newOffer();
    const received = await requestAction(offer.id, "receive", 1, RECEIVE_ONLY_SSC);
    expect(received.status).toBe(200);
    expect(await received.json()).toMatchObject({
      sscConfirmationStatus: "confirming",
      sscReceivedBy: RECEIVE_ONLY_SSC,
    });
    await expect(requestAction(offer.id, "complete", 1, RECEIVE_ONLY_SSC)).resolves.toHaveProperty(
      "status",
      403,
    );
    const [stored] = await db
      .select()
      .from(studioOfferDraft)
      .where(eq(studioOfferDraft.id, offer.id));
    expect(stored).toMatchObject({ sscCompletedBy: null, sscConfirmationStatus: "confirming" });
  });

  it("allows the custom confirm-only role to finish another SSC's receipt but never receive", async () => {
    const offer = await newOffer();
    await expect(requestAction(offer.id, "receive", 1, CONFIRM_ONLY_SSC)).resolves.toHaveProperty(
      "status",
      403,
    );
    await expect(requestAction(offer.id, "receive", 1, RECEIVE_ONLY_SSC)).resolves.toHaveProperty(
      "status",
      200,
    );
    const completed = await requestAction(offer.id, "complete", 1, CONFIRM_ONLY_SSC);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      sscCompletedBy: CONFIRM_ONLY_SSC,
      sscConfirmationStatus: "completed",
      sscReceivedBy: RECEIVE_ONLY_SSC,
    });
    const activity = await db
      .select({ operatorRole: interviewAuditLog.operatorRole })
      .from(interviewAuditLog)
      .where(eq(interviewAuditLog.organizationId, ORG))
      .orderBy(interviewAuditLog.createdAt);
    expect(activity.map((entry) => entry.operatorRole)).toEqual([
      "sscReceiveOnly",
      "sscConfirmOnly",
    ]);
  });

  it("does not accept an Offer through another candidate's URL", async () => {
    const offer = await newOffer();
    await expect(
      requestAction(offer.id, "receive", 1, FIRST_SSC, "wrong-candidate"),
    ).resolves.toHaveProperty("status", 404);
  });

  it.each(["deleted", "superseded"] as const)(
    "rejects SSC actions on %s versions",
    async (status) => {
      const offer = await newOffer();
      await db.update(studioOfferDraft).set({ status }).where(eq(studioOfferDraft.id, offer.id));
      await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 409);
    },
  );

  it("rejects SSC actions after the candidate closes", async () => {
    const offer = await newOffer();
    await db
      .update(studioInterview)
      .set({ outcome: "withdrawn", pipelineStage: "closed" })
      .where(eq(studioInterview.id, CANDIDATE));
    await expect(requestAction(offer.id, "receive")).resolves.toHaveProperty("status", 409);
  });

  it("preserves the send behavior of historical null SSC records", async () => {
    const offer = await newOffer();
    await db
      .update(studioOfferDraft)
      .set({ sscConfirmationStatus: null })
      .where(eq(studioOfferDraft.id, offer.id));
    expect(await sendOfferDraft(offer.id, ORG)).toMatchObject({ status: "sent" });
  });

  it("provides a bot entry link only for an authorized Offer reader", async () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "@ssc_test_bot");
    const offer = await newOffer();
    const path = `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/telegram-link`;
    const response = await makeApp().request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: `https://t.me/ssc_test_bot?start=offer_${offer.id}`,
    });
    await expect(makeApp(FORBIDDEN_USER).request(path)).resolves.toHaveProperty("status", 403);
  });

  it.each(["", "undefined", "null", "@undefined", "NULL"])(
    "returns no bot entry link when the bot username is not configured: %s",
    async (username) => {
      vi.stubEnv("TELEGRAM_BOT_USERNAME", username);
      const offer = await newOffer();
      const response = await makeApp().request(
        `/${CANDIDATE}/offer-drafts/${offer.id}/ssc/telegram-link`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: null });
    },
  );
});
