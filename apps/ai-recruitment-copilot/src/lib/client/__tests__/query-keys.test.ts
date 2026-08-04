import { describe, expect, it, vi } from "vitest";
import {
  chatConversationKeys,
  humanInterviewKeys,
  invalidateHumanInterviewCandidateQueries,
  studioCalendarKeys,
  studioProfileKeys,
  studioResumeKeys,
} from "@/lib/client/api/query-keys";

describe("chatConversationKeys", () => {
  it("scopes cached conversation lists by workspace", () => {
    expect(chatConversationKeys.all).toEqual(["chat-conversations"]);
    expect(chatConversationKeys.list("acme")).toEqual(["chat-conversations", "acme"]);
  });
});

describe("humanInterviewKeys", () => {
  it("builds stable hierarchical keys for candidate human interview data", () => {
    expect(humanInterviewKeys.rounds("acme", "candidate_1")).toEqual([
      "human-interview-rounds",
      "acme",
      "candidate_1",
    ]);
    expect(humanInterviewKeys.meetings("acme", "candidate_1")).toEqual([
      "human-interview-meetings",
      "acme",
      "candidate_1",
    ]);
    expect(humanInterviewKeys.studioResumes()).toEqual(["studio-resumes"]);
  });

  it("invalidates rounds, meetings, and resume-library aggregates together", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(null);

    await invalidateHumanInterviewCandidateQueries(
      { invalidateQueries },
      { candidateId: "candidate_1", slug: "acme" },
    );

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["human-interview-rounds", "acme", "candidate_1"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ["human-interview-meetings", "acme", "candidate_1"],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ["studio-resumes"],
    });
  });
});

describe("studioCalendarKeys", () => {
  it("scopes cached events by workspace and visible range", () => {
    expect(studioCalendarKeys.range("acme", "2026-07-01", "2026-08-01")).toEqual([
      "studio-calendar",
      "acme",
      "2026-07-01",
      "2026-08-01",
    ]);
  });
});

describe("studio resume and profile keys", () => {
  it("keeps team and personal metrics in separate cache entries", () => {
    expect(studioResumeKeys.metrics("acme", "team")).toEqual([
      "studio-resumes",
      "acme",
      "metrics",
      "team",
    ]);
    expect(studioResumeKeys.metrics("acme", "personal")).toEqual([
      "studio-resumes",
      "acme",
      "metrics",
      "personal",
    ]);
  });

  it("scopes profile activity and mail accounts by workspace", () => {
    expect(studioProfileKeys.activity("acme")).toEqual(["studio-profile", "acme", "activity"]);
    expect(studioProfileKeys.mailIngestAccounts("acme")).toEqual([
      "studio-profile",
      "acme",
      "mail-ingest-accounts",
    ]);
  });
});
