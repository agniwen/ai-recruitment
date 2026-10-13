// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCandidateCredential } from "./entry-credential-api";

const api = vi.hoisted(() => ({ options: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      public: {
        "human-interview-meetings": {
          ":inviteToken": {
            "entry-credentials": { options: { $post: api.options }, verify: { $post: api.verify } },
          },
        },
      },
    },
  },
}));
vi.mock("@/lib/client/api", () => import("@/lib/client/api/rpc-fetch"));

const native = { create: vi.fn(), get: vi.fn() };
const buffer = () => new Uint8Array([1, 2, 3]).buffer;
function credential(id: string, registration = false) {
  return {
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({
      credProps: { future: "retained", rk: true },
      custom: { data: buffer(), slice: new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 4) },
    }),
    id,
    rawId: buffer(),
    response: registration
      ? {
          attestationObject: buffer(),
          clientDataJSON: buffer(),
          getAuthenticatorData: () => buffer(),
          getPublicKey: () => buffer(),
          getPublicKeyAlgorithm: () => -7,
          getTransports: () => ["hybrid", "internal"],
        }
      : {
          authenticatorData: buffer(),
          clientDataJSON: buffer(),
          signature: buffer(),
          userHandle: buffer(),
        },
    type: "public-key",
  };
}
function options(registration = false) {
  return {
    challengeId: "00000000-0000-4000-8000-000000000001",
    kind: registration ? "register" : "authenticate",
    options: registration
      ? {
          authenticatorSelection: { authenticatorAttachment: "platform" },
          challenge: "AQID",
          hints: ["client-device"],
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          rp: { id: "localhost", name: "面试入场凭据" },
          user: { displayName: "", id: "AQID", name: "入场凭据 test" },
        }
      : {
          challenge: "AQID",
          hints: ["client-device"],
          rpId: "localhost",
          userVerification: "required",
        },
    registration: { canCreate: true, createdCount: 0, limit: 2 },
  };
}
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", vi.fn());
  Object.defineProperty(navigator, "credentials", { configurable: true, value: native });
  native.get.mockReset().mockResolvedValue(credential("credential_A"));
  native.create.mockReset().mockResolvedValue(credential("credential_B", true));
  api.options.mockReset().mockImplementation(() => Promise.resolve(Response.json(options())));
  api.verify.mockReset().mockImplementation(() =>
    Promise.resolve(
      Response.json({
        credentialRef: "K-test",
        proof: "secret-proof",
        registration: { canCreate: true, createdCount: 0, limit: 2 },
      }),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "credentials");
});

describe("entry credential API with the real browser SDK", () => {
  it.each(["register", "authenticate"] as const)(
    "sends the complete serialized %s result without dropping response or extension fields",
    async (kind) => {
      api.options.mockResolvedValueOnce(Response.json(options(kind === "register")));
      await verifyCandidateCredential("invite", kind, {}, new AbortController().signal);
      const submitted = api.verify.mock.calls[0][0].json;
      expect(submitted.response).toEqual({
        authenticatorAttachment: "platform",
        clientExtensionResults: {
          credProps: { future: "retained", rk: true },
          custom: { data: "AQID", slice: "AQID" },
        },
        id: kind === "register" ? "credential_B" : "credential_A",
        rawId: "AQID",
        response:
          kind === "register"
            ? {
                attestationObject: "AQID",
                authenticatorData: "AQID",
                clientDataJSON: "AQID",
                publicKey: "AQID",
                publicKeyAlgorithm: -7,
                transports: ["hybrid", "internal"],
              }
            : {
                authenticatorData: "AQID",
                clientDataJSON: "AQID",
                signature: "AQID",
                userHandle: "AQID",
              },
        type: "public-key",
      });
      expect(navigator.credentials.create).toBe(native.create);
      expect(navigator.credentials.get).toBe(native.get);
      expect(sessionStorage.length).toBe(0);
    },
  );

  it("preserves a cancellation error and submits no credential", async () => {
    const error = new DOMException("Cancelled", "NotAllowedError");
    native.get.mockRejectedValueOnce(error);
    await expect(
      verifyCandidateCredential("invite", "authenticate", {}, new AbortController().signal),
    ).rejects.toMatchObject({ cause: error });
    expect(api.verify).not.toHaveBeenCalled();
  });

  it("aborts the pending native operation without submitting a late result", async () => {
    const started = Promise.withResolvers<unknown>();
    const pending = Promise.withResolvers<unknown>();
    native.get.mockImplementationOnce(({ signal }: CredentialRequestOptions) => {
      signal?.addEventListener("abort", () => pending.reject(signal.reason), { once: true });
      started.resolve(true);
      return pending.promise;
    });
    const controller = new AbortController();
    const rejected = expect(
      verifyCandidateCredential("invite", "authenticate", {}, controller.signal),
    ).rejects.toMatchObject({ cause: { name: "AbortError" } });
    await started.promise;
    controller.abort();
    await rejected;
    expect(api.verify).not.toHaveBeenCalled();
  });

  it("receives the server count before a cancelled get and forwards device hints to the native API", async () => {
    const registration = { canCreate: false, createdCount: 2, limit: 2 };
    api.options.mockResolvedValueOnce(Response.json({ ...options(), registration }));
    native.get.mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
    const onRegistration = vi.fn();
    await expect(
      verifyCandidateCredential(
        "invite",
        "authenticate",
        {},
        new AbortController().signal,
        onRegistration,
      ),
    ).rejects.toThrow();
    expect(onRegistration).toHaveBeenCalledExactlyOnceWith(registration);
    expect(native.get.mock.calls[0][0].publicKey.hints).toEqual(["client-device"]);
    expect(api.verify).not.toHaveBeenCalled();
    api.options.mockResolvedValueOnce(Response.json(options(true)));
    await verifyCandidateCredential("invite", "register", {}, new AbortController().signal);
    expect(native.create.mock.calls[0][0].publicKey).toMatchObject({
      authenticatorSelection: { authenticatorAttachment: "platform" },
      hints: ["client-device"],
    });
  });

  it.each(["options", "verify"] as const)(
    "refreshes the quota when %s rejects an over-limit registration",
    async (stage) => {
      const registration = { canCreate: false, createdCount: 2, limit: 2 };
      api.options.mockResolvedValueOnce(Response.json(options(true)));
      if (stage === "options") {
        api.options.mockReset();
      }
      api[stage].mockResolvedValueOnce(
        Response.json(
          {
            code: "entry_credential_registration_limit",
            error: "已达创建上限",
            registration,
          },
          { status: 409 },
        ),
      );
      const onRegistration = vi.fn();
      await expect(
        verifyCandidateCredential(
          "invite",
          "register",
          {},
          new AbortController().signal,
          onRegistration,
        ),
      ).rejects.toThrow("已达创建上限");
      expect(onRegistration).toHaveBeenLastCalledWith(registration);
      expect(native.create).toHaveBeenCalledTimes(stage === "options" ? 0 : 1);
    },
  );
});
