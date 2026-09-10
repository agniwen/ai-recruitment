import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  getUserAttachment: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/resume-parse-pipeline", () => ({
  generateResumeStructured: mocks.generate,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/job-description-match-agent", () => ({
  matchJobDescriptionForResume: vi.fn().mockResolvedValue({ jobDescriptionId: "jd1" }),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/agents/resume-parser-agent", () => ({
  toResumeProfile: (value: unknown) => value,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/routes/chat/dao/chat-attachments", () => ({
  findContentHashByAttachmentId: vi.fn().mockResolvedValue("hash1"),
  getUserAttachment: mocks.getUserAttachment,
  updateStructuredByHash: mocks.update,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/job-descriptions/dao",
  () => ({
    listAllJobDescriptions: vi.fn().mockResolvedValue([{ id: "jd1", name: "工程师" }]),
  }),
);

// oxlint-disable-next-line import/first -- imports follow the hoisted dependency mocks.
import { createSuggestJobDescriptionTool } from "./agent-tools";

function createTool() {
  return createSuggestJobDescriptionTool({
    orgId: "org1",
    resumes: [
      {
        attachmentId: "att1",
        filename: "resume.pdf",
        parsedStructured: null,
        parsedText: "候选人简历",
      },
    ],
    userId: "user1",
  });
}

beforeEach(() => {
  mocks.generate.mockReset().mockResolvedValue({ name: "候选人", sourceFileName: "resume.pdf" });
  mocks.update.mockReset().mockReturnValue(Promise.resolve());
  mocks.getUserAttachment.mockReset().mockResolvedValue(null);
});

it("reuses persisted extraction when a new tool instance receives an old message snapshot", async () => {
  await createTool().execute?.({}, { messages: [], toolCallId: "1" });
  mocks.getUserAttachment.mockResolvedValue({
    parsedStructured: { name: "候选人", sourceFileName: "resume.pdf" },
  });
  await createTool().execute?.({}, { messages: [], toolCallId: "2" });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.getUserAttachment).toHaveBeenCalledWith("user1", "org1", "att1");
});

it("reuses extraction across sequential and concurrent tool calls", async () => {
  const tool = createTool();
  await Promise.all([
    tool.execute?.({}, { messages: [], toolCallId: "1" }),
    tool.execute?.({}, { messages: [], toolCallId: "2" }),
  ]);
  await tool.execute?.({}, { messages: [], toolCallId: "3" });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.generate).toHaveBeenCalledWith("候选人简历", { fileName: "resume.pdf" });
  expect(mocks.update).toHaveBeenCalledTimes(1);
});

it("allows retry after failed extraction without retaining a rejected promise", async () => {
  mocks.generate.mockRejectedValueOnce(new Error("timeout"));
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const tool = createTool();
    expect(await tool.execute?.({}, { messages: [], toolCallId: "1" })).toMatchObject({
      status: "error",
    });
    expect(await tool.execute?.({}, { messages: [], toolCallId: "2" })).toMatchObject({
      status: "ok",
    });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  } finally {
    errorLog.mockRestore();
  }
});
