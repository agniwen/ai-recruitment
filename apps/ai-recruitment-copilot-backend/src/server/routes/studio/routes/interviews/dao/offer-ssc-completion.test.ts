import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeOfferSscWithScreenshot } from "./offer-ssc-completion";

const mocks = vi.hoisted(() => ({
  buildKey: vi.fn(),
  complete: vi.fn(),
  deleteObject: vi.fn(),
  load: vi.fn(),
  putObjectBytes: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  buildOfferApprovalAttachmentKey: mocks.buildKey,
  deleteObject: mocks.deleteObject,
  putObjectBytes: mocks.putObjectBytes,
}));
vi.mock("./offer-drafts", () => ({
  OfferDraftError: class extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  completeOfferSscConfirmationWithEvidence: mocks.complete,
  loadAuthorizedOfferSscContext: mocks.load,
}));

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const input = {
  actor: { id: "ssc", role: "ssc-role" },
  draftId: "draft",
  internalApprovalConfirmed: true as const,
  interviewRecordId: "candidate",
  organizationId: "org",
  revision: 3,
  source: "manual" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({
    canConfirm: true,
    draft: { sscConfirmationStatus: "confirming", sscRevision: 3, status: "draft" },
    pipelineStage: "offer",
  });
  mocks.buildKey.mockResolvedValue("private/new.png");
  mocks.putObjectBytes.mockResolvedValue(null);
  mocks.deleteObject.mockResolvedValue(null);
  mocks.complete.mockResolvedValue({
    attachmentUsed: true,
    draft: { id: "draft", sscConfirmationStatus: "completed" },
  });
});

describe("SSC completion screenshot service", () => {
  it("rejects pending recruiter contact confirmation before storing screenshots", async () => {
    mocks.load.mockResolvedValueOnce({
      canConfirm: true,
      draft: {
        recruiterConfirmationStatus: "pending",
        sscConfirmationStatus: "confirming",
        sscRevision: 3,
        status: "draft",
      },
      pipelineStage: "offer",
    });
    await expect(
      completeOfferSscWithScreenshot({
        ...input,
        file: new File([png], "approved.png", { type: "image/png" }),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("completes without requiring a screenshot", async () => {
    await expect(completeOfferSscWithScreenshot(input)).resolves.toMatchObject({
      sscConfirmationStatus: "completed",
    });
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ internalApprovalConfirmed: true }),
    );
  });

  it("stores a validated screenshot with the current revision using a sanitized filename", async () => {
    await completeOfferSscWithScreenshot({
      ...input,
      file: new File([png], "../approved.png", { type: "image/png" }),
    });
    expect(mocks.putObjectBytes).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ contentType: "image/png", storageKey: "private/new.png" }),
    );
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        completionAttachment: {
          filename: "approved.png",
          mediaType: "image/png",
          revision: 3,
          size: png.length,
          storageKey: "private/new.png",
        },
      }),
    );
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it.each([
    new File(["not an image"], "fake.png", { type: "image/png" }),
    new File([png], "mismatch.jpg", { type: "image/jpeg" }),
    new File([png], "script.svg", { type: "image/svg+xml" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ])("rejects invalid or oversized screenshots before storage", async (file) => {
    await expect(completeOfferSscWithScreenshot({ ...input, file })).rejects.toThrow();
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("denies a caller without confirmation permission before storing a screenshot", async () => {
    mocks.load.mockResolvedValueOnce({ canConfirm: false, draft: {}, pipelineStage: "offer" });
    await expect(
      completeOfferSscWithScreenshot({
        ...input,
        file: new File([png], "approved.png", { type: "image/png" }),
      }),
    ).rejects.toThrow();
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
  });

  it("cleans up an uploaded screenshot when the final transaction fails", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("revision changed"));
    await expect(
      completeOfferSscWithScreenshot({
        ...input,
        file: new File([png], "approved.png", { type: "image/png" }),
      }),
    ).rejects.toThrow("revision changed");
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith("private/new.png");
  });

  it("cleans up an unused upload after a concurrent completion without replacing its proof", async () => {
    mocks.complete.mockResolvedValueOnce({
      attachmentUsed: false,
      draft: { id: "draft", sscCompletionAttachment: { filename: "first.png" } },
    });
    const result = await completeOfferSscWithScreenshot({
      ...input,
      file: new File([png], "second.png", { type: "image/png" }),
    });
    expect(result).toHaveProperty("sscCompletionAttachment.filename", "first.png");
    expect(mocks.deleteObject).toHaveBeenCalledExactlyOnceWith("private/new.png");
  });
});
