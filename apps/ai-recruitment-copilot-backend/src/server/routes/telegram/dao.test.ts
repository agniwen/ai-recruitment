import { beforeEach, describe, expect, it, vi } from "vitest";
import { telegramRecipientBinding, telegramRequesterBinding, user } from "@arc/db-schema/schema";
import { bindTelegramUser } from "./dao";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  members: vi.fn(),
  requesters: vi.fn(),
  set: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  values: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.members }) }) }),
    selectDistinct: () => ({ from: () => ({ where: mocks.requesters }) }),
    transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.members.mockResolvedValue([]);
  mocks.requesters.mockResolvedValue([]);
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: vi.fn().mockResolvedValue(null) });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.upsert });
  mocks.upsert.mockResolvedValue(null);
  mocks.transaction.mockImplementation((run) =>
    run({ insert: mocks.insert, update: mocks.update }),
  );
});

const input = { chatId: "12345", username: "JackLil" };

describe("Telegram member and external requester binding", () => {
  it("binds an external requester across matching organizations and deduplicates jobs", async () => {
    mocks.requesters.mockResolvedValue([
      { organizationId: "org-a", requester: "李杰@JackLil/野火@yezhu803" },
      { organizationId: "org-a", requester: "李杰\n@jacklil" },
      { organizationId: "org-b", requester: "@JACKLIL" },
      { organizationId: "unrelated", requester: "@jacklil_extra" },
    ]);
    expect(await bindTelegramUser(input)).toEqual({
      kind: "requester_bound",
      memberAmbiguous: false,
      memberName: null,
    });
    expect(mocks.update).not.toHaveBeenCalledWith(user);
    expect(mocks.insert).toHaveBeenCalledWith(telegramRequesterBinding);
    expect(mocks.values).toHaveBeenCalledWith([
      { chatId: "12345", organizationId: "org-a", username: "jacklil" },
      { chatId: "12345", organizationId: "org-b", username: "jacklil" },
    ]);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        set: { chatId: "12345", updatedAt: expect.any(Date) },
        target: [telegramRequesterBinding.organizationId, telegramRequesterBinding.username],
      }),
    );
  });

  it("preserves member binding", async () => {
    mocks.members.mockResolvedValue([{ id: "member", name: "李杰" }]);
    expect(await bindTelegramUser(input)).toEqual({ kind: "bound", userName: "李杰" });
    expect(mocks.update).toHaveBeenCalledWith(user);
    expect(mocks.set).toHaveBeenCalledWith({
      telegramBoundUsername: "jacklil",
      telegramChatId: "12345",
      updatedAt: expect.any(Date),
    });
    expect(mocks.insert).toHaveBeenCalledWith(telegramRecipientBinding);
  });

  it("binds both identities in one transaction", async () => {
    mocks.members.mockResolvedValue([{ id: "member", name: "李杰" }]);
    mocks.requesters.mockResolvedValue([{ organizationId: "org", requester: "李杰@JackLil" }]);
    expect(await bindTelegramUser(input)).toEqual({
      kind: "requester_bound",
      memberAmbiguous: false,
      memberName: "李杰",
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(user);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it("does not bind ambiguous members but still binds an explicit requester handle", async () => {
    mocks.members.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    mocks.requesters.mockResolvedValue([{ organizationId: "org", requester: "@JackLil" }]);
    expect(await bindTelegramUser(input)).toEqual({
      kind: "requester_bound",
      memberAmbiguous: true,
      memberName: null,
    });
    expect(mocks.update).not.toHaveBeenCalledWith(user);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it("registers notifications without binding ambiguous members", async () => {
    mocks.members.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await bindTelegramUser(input)).toEqual({ kind: "registered", memberAmbiguous: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalledWith(user);
    expect(mocks.values).toHaveBeenCalledWith({ chatId: "12345", username: "jacklil" });
  });

  it("registers a sender even without a matching member or requester", async () => {
    mocks.requesters.mockResolvedValue([{ organizationId: "org", requester: "JackLil" }]);
    expect(await bindTelegramUser(input)).toEqual({ kind: "registered", memberAmbiguous: false });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalledWith(user);
    expect(mocks.values).toHaveBeenCalledWith({ chatId: "12345", username: "jacklil" });
  });

  it("registers followers without a Telegram username or system identity", async () => {
    expect(await bindTelegramUser({ ...input, username: undefined })).toEqual({
      kind: "registered",
      memberAmbiguous: false,
    });
    expect(mocks.insert).toHaveBeenCalledWith(telegramRecipientBinding);
    expect(mocks.values).toHaveBeenCalledWith({ chatId: "12345", username: null });
    expect(mocks.upsert).toHaveBeenCalledWith({
      set: { updatedAt: expect.any(Date), username: null },
      target: telegramRecipientBinding.chatId,
    });
    expect(mocks.members).not.toHaveBeenCalled();
    expect(mocks.requesters).not.toHaveBeenCalled();
  });

  it("does not report success on persistence failure", async () => {
    mocks.requesters.mockResolvedValue([{ organizationId: "org", requester: "@JackLil" }]);
    mocks.upsert.mockRejectedValue(new Error("database unavailable"));
    await expect(bindTelegramUser(input)).rejects.toThrow("database unavailable");
  });
});
