import {
  MAX_PORTFOLIO_FILE_SIZE_BYTES,
  portfolioAttachmentSchema,
} from "@arc/shared/bulk-resume-upload";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { storePortfolioAttachment, validatePortfolioAttachments } from "./portfolio-attachments";

const mocks = vi.hoisted(() => ({
  buildAttachmentKey: vi.fn(),
  insert: vi.fn(),
  putObjectBytes: vi.fn(),
  rows: [] as { filename: string; id: string; mediaType: string; size: number }[],
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/s3", () => ({
  buildAttachmentKey: mocks.buildAttachmentKey,
  putObjectBytes: mocks.putObjectBytes,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    insert: () => ({ values: mocks.insert }),
    select: () => ({ from: () => ({ where: () => Promise.resolve(mocks.rows) }) }),
  },
}));

const attachment = {
  id: "90da6175-37c2-4528-bd7b-c9e4a081ff04",
  mimeType: "image/png",
  name: "作品.png",
  size: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.buildAttachmentKey.mockResolvedValue("chat-attachments/file.png");
  mocks.putObjectBytes.mockImplementation(async () => {});
  mocks.insert.mockImplementation(async () => {});
});

describe("portfolio attachments", () => {
  it.each([MAX_PORTFOLIO_FILE_SIZE_BYTES, MAX_PORTFOLIO_FILE_SIZE_BYTES + 1])(
    "enforces the single-file boundary at %i bytes",
    async (size) => {
      const file = new File(["zip"], "作品.zip", { type: "application/zip" });
      Object.defineProperty(file, "size", { value: size });
      const valid = size <= MAX_PORTFOLIO_FILE_SIZE_BYTES;
      expect(portfolioAttachmentSchema.safeParse({ ...attachment, size }).success).toBe(valid);
      if (valid) {
        await expect(storePortfolioAttachment(file, "org", "user")).resolves.toMatchObject({
          size,
        });
      } else {
        await expect(storePortfolioAttachment(file, "org", "user")).rejects.toThrow("500 MB");
        expect(mocks.putObjectBytes).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects HTML uploads before storing any bytes", async () => {
    await expect(
      storePortfolioAttachment(
        new File(["html"], "index.html", { type: "text/html" }),
        "org",
        "user",
      ),
    ).rejects.toThrow("仅支持");
    expect(mocks.putObjectBytes).not.toHaveBeenCalled();
  });

  it("stores a document without parsing or passing it to AI", async () => {
    const result = await storePortfolioAttachment(
      new File(["work"], "作品.png", { type: "image/png" }),
      "org",
      "user",
    );
    expect(result).toMatchObject({ mimeType: "image/png", name: "作品.png", size: 4 });
    expect(mocks.putObjectBytes).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        parsedStatus: "ready",
      }),
    );
    expect(mocks.insert.mock.calls[0]?.[0]).not.toHaveProperty("parsedText");
  });

  it("accepts only uploaded metadata and safe preview media types", async () => {
    mocks.rows = [{ filename: "作品.png", id: attachment.id, mediaType: "image/png", size: 4 }];
    expect(await validatePortfolioAttachments([attachment], "org", "user")).toBe(true);
    expect(
      await validatePortfolioAttachments([{ ...attachment, name: "changed.png" }], "org", "user"),
    ).toBe(false);
    mocks.rows = [{ filename: "作品.png", id: attachment.id, mediaType: "text/html", size: 4 }];
    expect(
      await validatePortfolioAttachments([{ ...attachment, mimeType: "text/html" }], "org", "user"),
    ).toBe(false);
  });
});
