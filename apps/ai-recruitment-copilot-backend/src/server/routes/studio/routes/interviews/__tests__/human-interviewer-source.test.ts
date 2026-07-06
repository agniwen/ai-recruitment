import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roundsDaoSource = readFileSync(
  new URL("../dao/human-interview-rounds.ts", import.meta.url),
  "utf-8",
);
const meetingsDaoSource = readFileSync(
  new URL("../dao/human-interview-meetings.ts", import.meta.url),
  "utf-8",
);
const interviewerGateSource = readFileSync(
  new URL("../dao/human-interview-interviewers.ts", import.meta.url),
  "utf-8",
);

describe("human interview interviewer source gates", () => {
  it("requires selected round interviewers to be workspace interviewer members", () => {
    expect(roundsDaoSource).toContain("assertWorkspaceInterviewers");
  });

  it("requires selected meeting interviewers to be workspace interviewer members", () => {
    expect(meetingsDaoSource).toContain("assertWorkspaceInterviewers");
  });

  it("implements the interviewer gate with the workspace member flag", () => {
    expect(interviewerGateSource).toContain("member.isInterviewer");
    expect(interviewerGateSource).toContain("存在未开启面试官身份的成员。");
  });
});
