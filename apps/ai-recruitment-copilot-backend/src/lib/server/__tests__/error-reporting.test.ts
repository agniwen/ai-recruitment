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
