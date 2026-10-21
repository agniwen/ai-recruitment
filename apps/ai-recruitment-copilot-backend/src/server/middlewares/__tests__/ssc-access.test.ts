import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "../../factory";
import {
  guardSscPublicSurface,
  guardSscWorkspaceSurface,
  requireSscCandidateAccess,
} from "../ssc-access";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), publicCandidate: vi.fn(), visible: vi.fn() }));
vi.mock("../../access/ssc-access", () => ({
  findSscPublicCandidate: mocks.publicCandidate,
  isSscCandidateVisible: mocks.visible,
  resolveSscAccessActor: mocks.actor,
}));

function makeApp(userId: string | null = "ssc") {
  return factory
    .createApp()
    .use("*", async (c, next) => {
      c.set("activeOrg", { id: "org" } as never);
      c.set("user", (userId ? { id: userId } : null) as never);
      c.set("member", { role: "ssc-01" } as never);
      await next();
    })
    .use("*", guardSscWorkspaceSurface())
    .use("*", guardSscPublicSurface())
    .get("/api/w/work/studio/resumes/:id/review", requireSscCandidateAccess(), (c) =>
      c.json({ protected: true }, 200),
    )
    .post(
      "/api/w/work/studio/interviews/:id/offer-drafts/:draftId/ssc/receive",
      requireSscCandidateAccess(),
      (c) => c.json({ changed: true }, 200),
    )
    .all("*", (c) => c.json({ legacy: true }, 200));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ organizationId: "org", userId: "ssc" });
  mocks.visible.mockResolvedValue(false);
  mocks.publicCandidate.mockResolvedValue({ candidateId: "candidate", organizationId: "org" });
});

describe("SSC workspace boundary", () => {
  it.each([
    "/api/w/work/studio/ai-review",
    "/api/w/work/studio/ai-review/candidate/reject",
    "/api/w/work/studio/resume-pool",
    "/api/w/work/studio/resume-upload-batches/active",
    "/api/w/work/studio/smart-resume-tasks",
    "/api/w/work/studio/odc-analysis",
    "/api/w/work/studio/interviews",
    "/api/w/work/studio/interviews/summary",
    "/api/w/work/studio/interviews/round/recordings",
    "/api/w/work/studio/job-descriptions/job/recommendations",
    "/api/w/work/chat/conversations",
    "/api/w/work/resume/chat",
    "/api/w/work/interview/parse-resume",
    "/api/w/work/studio/resumes/skill-suggestions",
    "/api/w/work/studio/resumes/dedup-check",
  ])("does not expose pre-Offer surface %s to SSC", async (path) => {
    const response = await makeApp().request(path);
    expect(response.status).toBe(403);
  });

  it("denies a shared review before its SSC Offer gate is satisfied", async () => {
    const response = await makeApp().request("/api/w/work/studio/resumes/candidate/review");
    expect(response.status).toBe(404);
  });

  it("permits a review after the current Offer and source gate succeeds", async () => {
    mocks.visible.mockResolvedValue(true);
    const response = await makeApp().request("/api/w/work/studio/resumes/candidate/review");
    expect(response.status).toBe(200);
  });

  it("denies an Offer action under a different candidate parent", async () => {
    const response = await makeApp().request(
      "/api/w/work/studio/interviews/allowed/offer-drafts/foreign/ssc/receive",
      { method: "POST" },
    );
    expect(response.status).toBe(404);
  });

  it("preserves ordinary roles and external review behavior", async () => {
    mocks.actor.mockResolvedValue(null);
    const poolResponse = await makeApp().request("/api/w/work/studio/resume-pool");
    expect(poolResponse.status).toBe(200);
    const reviewResponse = await makeApp().request("/api/w/work/studio/resumes/candidate/review");
    expect(reviewResponse.status).toBe(200);
  });

  it("keeps creation-context as a candidate collection read instead of an Offer id", async () => {
    mocks.visible.mockImplementation(({ draftId }: { draftId?: string }) =>
      Promise.resolve(draftId === undefined),
    );
    const response = await makeApp().request(
      "/api/w/work/studio/interviews/allowed/offer-drafts/creation-context",
    );
    expect(response.status).toBe(200);
    expect(mocks.visible).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: "allowed", draftId: undefined }),
    );
  });

  it("keeps ordinary static job/source metadata and candidate lists on their own permissions", async () => {
    const jobResponse = await makeApp().request("/api/w/work/studio/job-descriptions");
    expect(jobResponse.status).toBe(200);
    const sourceResponse = await makeApp().request("/api/w/work/studio/resume-sources");
    expect(sourceResponse.status).toBe(200);
    const resumeResponse = await makeApp().request("/api/w/work/studio/resumes");
    expect(resumeResponse.status).toBe(200);
  });

  it.each([
    "/api/public/resumes/candidate",
    "/api/public/resumes/candidate/rounds",
    "/api/public/interview-rounds/round/reports",
    "/api/public/interview-rounds/round/resume",
    "/api/public/interview-rounds/round/recordings/conversation",
    "/api/public/interview-rounds/resolve?id=candidate",
    "/api/interview/candidate/round",
  ])("does not let an authenticated SSC bypass scope through %s", async (path) => {
    const authenticatedResponse = await makeApp().request(path);
    expect(authenticatedResponse.status).toBe(404);
    const anonymousResponse = await makeApp(null).request(path);
    expect(anonymousResponse.status).toBe(200);
  });
});
