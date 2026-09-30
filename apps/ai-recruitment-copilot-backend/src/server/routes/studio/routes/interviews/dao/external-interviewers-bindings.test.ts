import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExternalInterviewerBindings } from "./external-interviewers";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.query }) }) },
}));

beforeEach(() => vi.resetAllMocks());

describe("external interviewer notification recipients", () => {
  it("resolves a registered non-member without requester configuration", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ chatId: "12345", username: "external" }])
      .mockResolvedValueOnce([]);
    expect(
      await resolveExternalInterviewerBindings("org", [
        { name: "外部面试官", telegram: "@External" },
        { name: "未登记", telegram: "@unknown" },
      ]),
    ).toEqual([
      { chatId: "12345", name: "外部面试官", telegram: "@External" },
      { chatId: null, name: "未登记", telegram: "@unknown" },
    ]);
  });

  it("uses the latest opt-in recipient over legacy bindings", async () => {
    mocks.query
      .mockResolvedValueOnce([{ chatId: "old", username: "external" }])
      .mockResolvedValueOnce([{ chatId: "new", username: "external" }])
      .mockResolvedValueOnce([
        { boundUsername: "external", chatId: "member", telegram: "@external" },
      ]);
    expect(
      await resolveExternalInterviewerBindings("org", [
        { name: "外部面试官", telegram: "@external" },
      ]),
    ).toEqual([{ chatId: "new", name: "外部面试官", telegram: "@external" }]);
  });

  it("preserves legacy requester bindings", async () => {
    mocks.query
      .mockResolvedValueOnce([{ chatId: "legacy", username: "external" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    expect(
      await resolveExternalInterviewerBindings("org", [
        { name: "外部面试官", telegram: "@external" },
      ]),
    ).toEqual([{ chatId: "legacy", name: "外部面试官", telegram: "@external" }]);
  });

  it("does not look up recipients without a username", async () => {
    expect(
      await resolveExternalInterviewerBindings("org", [{ name: "面试官", telegram: "" }]),
    ).toEqual([{ chatId: null, name: "面试官", telegram: "" }]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
