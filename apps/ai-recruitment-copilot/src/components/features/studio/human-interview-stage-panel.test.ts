import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(import.meta.dirname, "human-interview-stage-panel.tsx"),
  "utf-8",
);

describe("HumanInterviewStagePanel editing gates", () => {
  it("lets pending human interview edits submit interviewers with the schedule", () => {
    expect(source).toContain("const [interviewerIds, setInterviewerIds] = useState(() =>");
    expect(source).toContain("round.interviewers.map((interviewer) => interviewer.id)");
    expect(source).toContain("interviewerIds,");
    expect(source).toContain("disabled={mutation.isPending || interviewerIds.length === 0}");
  });

  it("only offers members marked as interviewers in human interview selectors", () => {
    expect(source).toContain("isInterviewer: boolean;");
    expect(source).toContain("member.isInterviewer");
    expect(source).toContain("interviewerMemberOptions");
    expect(source).toContain('emptyMessage="暂无可选面试官"');
  });

  it("requires feedback before completing a human interview round", () => {
    expect(source).toContain("const trimmedFeedback = feedback.trim();");
    expect(source).toContain("请填写面试评价");
    expect(source).toContain("feedback: trimmedFeedback");
    expect(source).toContain("disabled={mutation.isPending || !feedback.trim()}");
    expect(source).toContain("面试评价");
  });

  it("blocks scheduling another round while a completed round is missing feedback", () => {
    expect(source).toContain("missingFeedbackRounds");
    expect(source).toContain("请先填写已完成轮次的面试评价，再安排下一轮。");
    expect(source).toContain("disabled={hasMissingCompletedRoundFeedback}");
  });
});
