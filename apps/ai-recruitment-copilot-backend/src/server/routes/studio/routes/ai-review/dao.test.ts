import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAiReviewNotificationRecipients } from "./dao";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), select: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));

function recipient(rolePermission: string, userId = "odc") {
  return {
    email: `${userId}@example.com`,
    name: userId,
    rolePermission,
    telegram: "@test_odc",
    telegramBoundUsername: "test_odc",
    telegramChatId: "12345",
    userId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: mocks.rows,
    where: vi.fn().mockReturnThis(),
  };
  mocks.select.mockReturnValue(query);
});

describe("AI review ODC recipient candidate-management permission", () => {
  it("keeps only ODC query results whose role grants page:resumes", async () => {
    mocks.rows.mockResolvedValue([
      recipient('{"page":["resumes","me"]}', "allowed"),
      recipient('{"page":["jobDescriptions","me"]}', "no-page-access"),
      recipient('{"resumeLibrary":["read","create"]}', "only-actions"),
    ]);
    expect(
      await listAiReviewNotificationRecipients({ candidateId: "candidate", organizationId: "org" }),
    ).toEqual([
      { chatId: "12345", email: "allowed@example.com", name: "allowed", userId: "allowed" },
    ]);
  });

  it.each(["{}", "null", "not-json", '{"page":"resumes"}', '{"page":["resumes-extra"]}'])(
    "does not grant access for missing or invalid permission %s",
    async (permission) => {
      mocks.rows.mockResolvedValue([recipient(permission)]);
      expect(
        await listAiReviewNotificationRecipients({
          candidateId: "candidate",
          organizationId: "org",
        }),
      ).toEqual([]);
    },
  );

  it("preserves the unbound-Telegram state for otherwise eligible members", async () => {
    mocks.rows.mockResolvedValue([{ ...recipient('{"page":["resumes"]}'), telegramChatId: null }]);
    expect(
      await listAiReviewNotificationRecipients({ candidateId: "candidate", organizationId: "org" }),
    ).toEqual([{ chatId: null, email: "odc@example.com", name: "odc", userId: "odc" }]);
  });

  it("rechecks role permissions using the provided approval transaction", async () => {
    const transactionQuery = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([recipient('{"page":["me"]}')]),
      where: vi.fn().mockReturnThis(),
    };
    const executor = { select: vi.fn().mockReturnValue(transactionQuery) };
    expect(
      await listAiReviewNotificationRecipients(
        { candidateId: "candidate", organizationId: "org" },
        executor,
      ),
    ).toEqual([]);
    expect(executor.select).toHaveBeenCalledOnce();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
