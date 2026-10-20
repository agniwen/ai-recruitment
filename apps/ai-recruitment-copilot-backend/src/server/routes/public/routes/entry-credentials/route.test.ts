import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "../../../../factory";
import { entryCredentialsRouter } from "./route";
import { EntryRegistrationLimitError } from "./service";
import type * as EntryCredentialService from "./service";

const mocks = vi.hoisted(() => ({
  event: vi.fn(),
  options: vi.fn(),
  policy: vi.fn(),
  resolve: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../../../studio/routes/interviews/dao/human-interview-meetings", () => ({
  resolveHumanInterviewMeetingInviteToken: mocks.resolve,
}));
vi.mock("./policy", () => ({
  entryRelyingParty: () => ({
    origin: "https://interview.example.test",
    rpID: "interview.example.test",
  }),
  getCandidateEntryPolicy: mocks.policy,
}));
vi.mock("./service", async (importOriginal) => ({
  ...(await importOriginal<typeof EntryCredentialService>()),
  createEntryOptions: mocks.options,
  recordCredentialEvent: mocks.event,
  verifyEntryCredential: mocks.verify,
}));
const app = factory.createApp().route("/:inviteToken/entry-credentials", entryCredentialsRouter);
const scope = { scheduledAt: null, status: "in_progress", validUntil: "2099-01-01T00:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(scope);
  mocks.policy.mockResolvedValue({ required: true });
  mocks.options.mockResolvedValue({ challengeId: "test", kind: "authenticate" });
  mocks.verify.mockResolvedValue({ credentialRef: "K-test", proof: "proof" });
});
function request(path = "options", json?: unknown, origin = "https://interview.example.test") {
  return app.request(`/invite/entry-credentials/${path}`, {
    body: JSON.stringify(json ?? { kind: "authenticate" }),
    headers: { "Content-Type": "application/json", Origin: origin },
    method: "POST",
  });
}
describe("public credential request boundary", () => {
  it("requires the configured origin and valid invitation before starting a ceremony", async () => {
    const foreign = await request(
      "options",
      { kind: "authenticate" },
      "https://foreign.example.test",
    );
    expect(foreign.status).toBe(403);
    const missingOrigin = await request("options", { kind: "authenticate" }, "");
    expect(missingOrigin.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValueOnce(null);
    await expect(request()).resolves.toMatchObject({ status: 404 });
    expect(mocks.options).not.toHaveBeenCalled();
  });
  it("does not create challenges while disabled, too early, expired or closed", async () => {
    mocks.policy.mockResolvedValueOnce({ required: false });
    await expect(request()).resolves.toMatchObject({ status: 409 });
    for (const inaccessible of [
      { ...scope, status: "ended" },
      { ...scope, status: "cancelled" },
      { ...scope, validUntil: "2000-01-01T00:00:00Z" },
      { ...scope, scheduledAt: "2098-01-01T00:00:00Z", status: "scheduled" },
    ]) {
      mocks.resolve.mockResolvedValueOnce(inaccessible);
      await expect(request()).resolves.toMatchObject({ status: 403 });
    }
    expect(mocks.options).not.toHaveBeenCalled();
  });
  it("validates request shape and never caches challenges or proofs", async () => {
    await expect(request("options", { kind: "skip" })).resolves.toMatchObject({ status: 400 });
    await expect(
      request("verify", { kind: "authenticate", proof: "forged" }),
    ).resolves.toMatchObject({ status: 400 });
    const valid = await request();
    expect(valid.status).toBe(200);
    expect(valid.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.options).toHaveBeenCalledOnce();
    const huge = await request("verify", { unexpected: "x".repeat(100_001) });
    expect(huge.status).toBe(413);
  });
  it("returns the registration limit without leaking an internal failure", async () => {
    const registration = { canCreate: false, createdCount: 2, limit: 2 };
    mocks.options.mockRejectedValueOnce(new EntryRegistrationLimitError(registration));

    const response = await request("options", { kind: "register" });

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      code: "entry_credential_registration_limit",
      registration,
    });
  });
  it("validates a credential response and sanitizes verifier failures", async () => {
    const input = {
      challengeId: "00000000-0000-4000-8000-000000000001",
      kind: "authenticate",
      response: {
        clientExtensionResults: {},
        id: "AA",
        rawId: "AA",
        response: {
          authenticatorData: "AA",
          clientDataJSON: "AA",
          signature: "AA",
          userHandle: "AA",
        },
        type: "public-key",
      },
    };
    const verified = await request("verify", input);
    expect(verified.status).toBe(200);
    expect(verified.headers.get("Cache-Control")).toBe("no-store");
    expect(await verified.json()).toEqual({ credentialRef: "K-test", proof: "proof" });
    mocks.verify.mockRejectedValueOnce(new Error("private verifier detail"));
    const failed = await request("verify", input);
    expect(failed.status).toBe(400);
    expect(await failed.text()).not.toContain("private verifier detail");
    expect(mocks.event).toHaveBeenCalledWith(
      scope,
      expect.any(Headers),
      "entry_credential_failed",
      { reason: "verification_failed" },
    );
  });
});
