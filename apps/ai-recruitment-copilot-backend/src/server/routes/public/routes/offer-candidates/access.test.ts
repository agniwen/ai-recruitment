import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOfferCandidatePreviewLink, verifyOfferCandidatePreviewToken } from "./access";

const now = new Date("2026-10-19T06:00:00.000Z");
const context = {
  actorUserId: "ssc-user",

  candidateId: "candidate-a",

  draftId: "550e8400-e29b-41d4-a716-446655440000",

  organizationId: "org-a",

  revision: 3,
};

function signedPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "test-preview-secret")
    .update(`offer-candidate-readonly:v1:${encoded}`)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function tokenFromLink() {
  const link = buildOfferCandidatePreviewLink(context);
  return new URL(link ?? "").pathname.split("/").at(-1) ?? "";
}

describe("Offer candidate external link credentials", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("BETTER_AUTH_SECRET", "test-preview-secret");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ats.example.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.example.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("issues a scoped read-only link valid for seven days without account credentials", () => {
    const link = buildOfferCandidatePreviewLink(context);
    expect(link).toMatch(/^https:\/\/ats\.example\.test\/offer-candidate\//u);
    expect(verifyOfferCandidatePreviewToken(tokenFromLink())).toEqual({
      actorUserId: "ssc-user",
      candidateId: "candidate-a",
      draftId: "550e8400-e29b-41d4-a716-446655440000",
      exp: new Date("2026-10-26T06:00:00.000Z").getTime(),
      organizationId: "org-a",
      purpose: "offer-candidate-readonly:v1",
      revision: 3,
    });
  });

  it("issues TG-only details credentials without a system account", () => {
    const { actorUserId: _actorUserId, ...scope } = context;
    const link = buildOfferCandidatePreviewLink({
      ...scope,
      telegramActor: { telegramUserId: "12345", username: "sscalice" },
    });
    const token = new URL(link ?? "").pathname.split("/").at(-1) ?? "";
    expect(verifyOfferCandidatePreviewToken(token)).toMatchObject({
      ...scope,
      telegramActor: { telegramUserId: "12345", username: "sscalice" },
    });
    expect(verifyOfferCandidatePreviewToken(token)).not.toHaveProperty("actorUserId");
  });

  it("uses the configured auth origin when the public origin is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    expect(buildOfferCandidatePreviewLink(context)).toMatch(/^https:\/\/auth\.example\.test\//u);
  });

  it("omits the link when no application origin is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(buildOfferCandidatePreviewLink(context)).toBeNull();
  });

  it("does not issue a credential for an untrusted URL protocol", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "ftp://untrusted.example.test");
    expect(() => buildOfferCandidatePreviewLink(context)).toThrow();
  });

  it("rejects an expired link at the exact expiry boundary", () => {
    const token = tokenFromLink();
    vi.setSystemTime(new Date("2026-10-26T06:00:00.000Z"));
    expect(verifyOfferCandidatePreviewToken(token)).toBeNull();
  });

  it("rejects an altered candidate even when the remainder of the token is intact", () => {
    const [encoded, signature] = tokenFromLink().split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    const altered = Buffer.from(
      JSON.stringify({ ...payload, candidateId: "candidate-b" }),
    ).toString("base64url");
    expect(verifyOfferCandidatePreviewToken(`${altered}.${signature}`)).toBeNull();
  });

  it.each(["", "a".repeat(2049), "abc.def.extra", "YWJj=.abc", "abc.!bad"])(
    "rejects malformed or oversized tokens: %s",
    (token) => expect(verifyOfferCandidatePreviewToken(token)).toBeNull(),
  );

  it("rejects noncanonical signature encodings", () => {
    const token = tokenFromLink();
    expect(verifyOfferCandidatePreviewToken(`${token}=`)).toBeNull();
  });

  it.each([
    { purpose: "human-interview" },
    { extraPermission: "write" },
    { revision: 0 },
    { actorUserId: "" },
    { exp: new Date("2026-10-27T06:00:00.000Z").getTime() },
  ])("rejects an otherwise signed credential outside the strict contract: %j", (override) => {
    const payload = verifyOfferCandidatePreviewToken(tokenFromLink());
    expect(verifyOfferCandidatePreviewToken(signedPayload({ ...payload, ...override }))).toBeNull();
  });

  it("rejects a previously issued token after the signing secret changes", () => {
    const token = tokenFromLink();
    vi.stubEnv("BETTER_AUTH_SECRET", "different-secret");
    expect(verifyOfferCandidatePreviewToken(token)).toBeNull();
  });
});
