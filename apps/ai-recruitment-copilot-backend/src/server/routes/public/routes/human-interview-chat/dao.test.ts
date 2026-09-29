import { beforeEach, describe, expect, it, vi } from "vitest";
import { listHumanInterviewChatMessages, saveHumanInterviewChatMessage } from "./dao";

const query = vi.hoisted(() => ({
  existing: vi.fn(),
  inserted: vi.fn(),
  rows: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: {
    insert: () => ({ values: query.values }),
    select: () => ({ from: () => ({ where: query.where }) }),
  },
}));
const input = {
  id: "message-1",
  meetingId: "meeting-1",
  message: "你好",
  organizationId: "org-1",
  participantIdentity: "candidate_round-1",
  senderName: "张三",
};
const row = {
  content: input.message,
  createdAt: new Date("2026-09-29T02:00:00Z"),
  id: input.id,
  meetingId: input.meetingId,
  organizationId: input.organizationId,
  participantIdentity: input.participantIdentity,
  senderName: input.senderName,
};
beforeEach(() => {
  vi.clearAllMocks();
  query.values.mockReturnValue({ onConflictDoNothing: () => ({ returning: query.inserted }) });
  query.where.mockReturnValue({ limit: query.existing, orderBy: query.rows });
  query.inserted.mockResolvedValue([]);
  query.existing.mockResolvedValue([row]);
  query.rows.mockResolvedValue([row]);
});
describe("persisted human meeting chat", () => {
  it("stores the meeting and sender and serializes persisted timestamps for history", async () => {
    query.inserted.mockResolvedValue([row]);
    const saved = await saveHumanInterviewChatMessage(input);
    expect(query.values).toHaveBeenCalledWith({
      content: "你好",
      id: input.id,
      meetingId: input.meetingId,
      organizationId: input.organizationId,
      participantIdentity: input.participantIdentity,
      senderName: input.senderName,
    });
    const history = await listHumanInterviewChatMessages(input);
    expect(history).toEqual([saved]);
    expect(saved?.timestamp).toBe("2026-09-29T02:00:00.000Z");
    expect(saved).not.toHaveProperty("organizationId");
  });
  it("returns the existing message for an identical retry", async () => {
    const saved = await saveHumanInterviewChatMessage(input);
    expect(saved?.id).toBe(input.id);
  });
  it.each([
    { meetingId: "other-meeting" },
    { organizationId: "other-org" },
    { participantIdentity: "other-sender" },
    { content: "other-content" },
  ])("does not return a conflicting message: %j", async (change) => {
    query.existing.mockResolvedValue([{ ...row, ...change }]);
    expect(await saveHumanInterviewChatMessage(input)).toBeNull();
  });
});
