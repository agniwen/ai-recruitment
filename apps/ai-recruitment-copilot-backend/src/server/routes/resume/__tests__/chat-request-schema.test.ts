import { describe, expect, it } from "vitest";
import { resumeChatRequestSchema } from "../schema";

const baseRequest = {
  chatId: "chat-1",
  messages: [],
  trigger: "submit-message" as const,
};

describe("resumeChatRequestSchema", () => {
  it("accepts an explicit resume-record focus", () => {
    expect(
      resumeChatRequestSchema.parse({
        ...baseRequest,
        focus: { id: "resume-1", kind: "resume_record" },
      }),
    ).toMatchObject({
      focus: { id: "resume-1", kind: "resume_record" },
    });
  });

  it.each(["studioResumeId", "model", "jobDescription"])(
    "accepts the supported context field %s",
    (field) => {
      expect(
        resumeChatRequestSchema.parse({ ...baseRequest, [field]: "context-value" }),
      ).toMatchObject({ [field]: "context-value" });
    },
  );

  it("strips unsupported thinking options", () => {
    expect(
      resumeChatRequestSchema.parse({ ...baseRequest, enableThinking: false }),
    ).not.toHaveProperty("enableThinking");
  });
});
