import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExternalInterviewerBindings } from "./external-interviewers";

const mocks = vi.hoisted(() => ({ rows: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.rows }) }) },
}));

beforeEach(() => vi.resetAllMocks());

describe("external interviewer Telegram bindings", () => {
  it("accepts a system user's binding without a requester binding", async () => {
    mocks.rows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ boundUsername: "tester1", chatId: "123", telegram: "@Tester1" }]);
    expect(
      await resolveExternalInterviewerBindings("org", [{ name: "外部", telegram: " @TESTER1 " }]),
    ).toEqual([{ chatId: "123", name: "外部", telegram: " @TESTER1 " }]);
  });

  it("rejects missing chat ids and bindings for an old profile username", async () => {
    mocks.rows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { boundUsername: "tester1", chatId: null, telegram: "@tester1" },
        { boundUsername: "oldname", chatId: "456", telegram: "@tester2" },
      ]);
    expect(
      await resolveExternalInterviewerBindings("org", [
        { name: "A", telegram: "@tester1" },
        { name: "B", telegram: "@tester2" },
      ]),
    ).toEqual([
      { chatId: null, name: "A", telegram: "@tester1" },
      { chatId: null, name: "B", telegram: "@tester2" },
    ]);
  });

  it("preserves requester bindings and adds system user recipients", async () => {
    mocks.rows
      .mockResolvedValueOnce([{ chatId: "123", username: "tester1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { boundUsername: "tester1", chatId: "123", telegram: "@tester1" },
        { boundUsername: "tester2", chatId: "456", telegram: "@tester2" },
      ]);
    expect(
      await resolveExternalInterviewerBindings("org", [
        { name: "A", telegram: "@tester1" },
        { name: "B", telegram: "@tester2" },
        { name: "C", telegram: "@unknown" },
      ]),
    ).toEqual([
      { chatId: "123", name: "A", telegram: "@tester1" },
      { chatId: "456", name: "B", telegram: "@tester2" },
      { chatId: null, name: "C", telegram: "@unknown" },
    ]);
  });

  it("uses registered recipient bindings before requester and system profile bindings", async () => {
    mocks.rows
      .mockResolvedValueOnce([{ chatId: "requester-chat", username: "tester1" }])
      .mockResolvedValueOnce([{ chatId: "registered-chat", username: "tester1" }])
      .mockResolvedValueOnce([
        { boundUsername: "tester1", chatId: "profile-chat", telegram: "@tester1" },
      ]);

    expect(
      await resolveExternalInterviewerBindings("org", [{ name: "A", telegram: "@Tester1" }]),
    ).toEqual([{ chatId: "registered-chat", name: "A", telegram: "@Tester1" }]);
  });

  it("leaves empty or invalid handles unbound without querying", async () => {
    expect(
      await resolveExternalInterviewerBindings("org", [
        { name: "A", telegram: "" },
        { name: "B", telegram: "@abc" },
        { name: "C", telegram: "123456" },
      ]),
    ).toEqual([
      { chatId: null, name: "A", telegram: "" },
      { chatId: null, name: "B", telegram: "@abc" },
      { chatId: null, name: "C", telegram: "123456" },
    ]);
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
