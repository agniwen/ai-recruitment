import { describe, expect, it } from "vitest";
import { redactInterviewLogLine } from "./request-logger";

describe("interview access log redaction", () => {
  it("keeps Offer preview credentials and query values out of page and file access logs", () => {
    for (const path of ["offer-candidate", "api/public/offer-candidates"]) {
      for (const suffix of ["", "/resume"]) {
        expect(
          redactInterviewLogLine(
            `--> GET /${path}/private-preview-token${suffix}?secret=hidden 200 2ms`,
          ),
        ).toBe(`--> GET /${path}/[REDACTED]${suffix} 200 2ms`);
      }
    }
  });

  it("removes candidate and interviewer credentials and log search criteria", () => {
    for (const path of ["human-interview", "api/public/human-interview-meetings"]) {
      for (const role of ["", "interviewer/"]) {
        expect(
          redactInterviewLogLine(`--> POST /${path}/${role}secret-token/livekit-token 200 2ms`),
        ).toBe(`--> POST /${path}/${role}[REDACTED]/livekit-token 200 2ms`);
      }
    }
    expect(redactInterviewLogLine("<-- GET /human-interview/secret?token=private")).toBe(
      "<-- GET /human-interview/[REDACTED]",
    );
    expect(
      redactInterviewLogLine(
        "--> GET /api/platform/interview-logs/meeting?ip=private&fingerprint=secret 200 3ms",
      ),
    ).toBe("--> GET /api/platform/interview-logs/meeting 200 3ms");
    expect(
      redactInterviewLogLine(
        "<-- POST /api/public/human-interview-meetings/secret/livekit-token?token=private",
      ),
    ).toBe("<-- POST /api/public/human-interview-meetings/[REDACTED]/livekit-token");
    expect(redactInterviewLogLine("--> GET /api/platform/users 200 1ms")).toBe(
      "--> GET /api/platform/users 200 1ms",
    );
  });
});
