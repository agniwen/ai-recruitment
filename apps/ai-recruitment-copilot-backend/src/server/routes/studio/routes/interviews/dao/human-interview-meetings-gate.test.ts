import { describe, expect, it, vi } from "vitest";
import { createHumanInterviewMeeting } from "./human-interview-meetings";

const mocks = vi.hoisted(() => ({
  assertWorkspaceInterviewers: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("./human-interview-interviewers", () => ({
  assertWorkspaceInterviewers: mocks.assertWorkspaceInterviewers,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select, transaction: mocks.transaction },
}));

describe("createHumanInterviewMeeting interviewer gate", () => {
  it("rejects ineligible interviewers before reading rounds or writing a meeting", async () => {
    mocks.assertWorkspaceInterviewers.mockImplementationOnce(({ makeError }) => {
      throw makeError("存在未开启面试官身份的成员。");
    });

    await expect(
      createHumanInterviewMeeting({
        createdBy: "creator-1",
        input: {
          interviewerIds: ["user-1", "user-1"],
          roundIds: ["round-1"],
          title: "真人面试",
        },
        organizationId: "org-1",
      }),
    ).rejects.toMatchObject({ message: "存在未开启面试官身份的成员。", status: 400 });
    expect(mocks.assertWorkspaceInterviewers).toHaveBeenCalledWith({
      makeError: expect.any(Function),
      organizationId: "org-1",
      userIds: ["user-1"],
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
