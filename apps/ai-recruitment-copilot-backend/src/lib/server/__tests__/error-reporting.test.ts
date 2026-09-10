import { describe, expect, it } from "vitest";
import {
  describeError,
  serializeErrorDetails,
} from "@arc/ai-recruitment-copilot-backend/lib/server/error-reporting";

describe("error reporting", () => {
  it("reads nested provider messages from serialized errors", () => {
    expect(
      describeError(
        { error: { code: "Throttling", message: "DashScope rate limit exceeded", status: 429 } },
        "解析失败",
      ),
    ).toBe("DashScope rate limit exceeded");
  });

  it("retains full model responses in nested errors without request credentials", () => {
    const text = `{"name":${"候选人".repeat(3000)}`;
    const error = new Error("解析失败", {
      cause: Object.assign(new Error("invalid object"), {
        request: { headers: { authorization: "secret" } },
        text,
      }),
    });
    const details = serializeErrorDetails(error);
    expect(details).toMatchObject({ chain: [{}, { modelResponse: { text } }] });
    expect(JSON.stringify(details)).not.toContain("secret");
  });

  it("retains the invalid value supplied by Mastra validation errors", () => {
    const error = { details: { value: '{"age":"unknown"}' }, message: "schema invalid" };
    expect(serializeErrorDetails(error)).toMatchObject({
      chain: [{ modelResponse: { objectJson: '{"age":"unknown"}' } }],
    });
  });

  it("records a bounded, safe cause chain", () => {
    const cause = Object.assign(new Error("upstream timed out"), {
      code: "ETIMEDOUT",
      status: 504,
    });
    const error = new Error("structured extraction failed", { cause });

    expect(serializeErrorDetails(error)).toMatchObject({
      chain: [
        { message: "structured extraction failed", name: "Error" },
        { code: "ETIMEDOUT", message: "upstream timed out", name: "Error", status: 504 },
      ],
    });
  });
});
