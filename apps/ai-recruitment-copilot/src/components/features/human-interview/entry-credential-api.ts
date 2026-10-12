import { entryCredentialVerificationSchema } from "@arc/shared/entry-credentials";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api";
import type { InferResponseType } from "hono/client";

const api = rpc.api.public["human-interview-meetings"][":inviteToken"]["entry-credentials"];
type EntryOptions = InferResponseType<typeof api.options.$post, 200>;
type EntryResult = InferResponseType<typeof api.verify.$post, 200>;

export async function verifyCandidateCredential(
  inviteToken: string,
  kind: "register" | "authenticate",
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  if (!window.isSecureContext || !window.PublicKeyCredential) {
    throw new Error("当前浏览器不支持通行密钥，请使用新版浏览器打开 HTTPS 面试链接，或联系 HR。");
  }
  // Load only after the candidate explicitly chooses an operation.
  const sdk = await import("@simplewebauthn/browser");
  signal.throwIfAborted();
  const cancel = () => sdk.WebAuthnAbortService.cancelCeremony();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const options = await rpcFetch<EntryOptions>(
      api.options.$post({ json: { kind }, param: { inviteToken } }, { headers, init: { signal } }),
      "无法发起凭据验证，请重试或联系 HR。",
    );
    signal.throwIfAborted();
    const response =
      options.kind === "register"
        ? await sdk.startRegistration({ optionsJSON: options.options })
        : await sdk.startAuthentication({ optionsJSON: options.options });
    signal.throwIfAborted();
    const json = entryCredentialVerificationSchema.parse({
      challengeId: options.challengeId,
      kind: options.kind,
      response,
    });
    return await rpcFetch<EntryResult>(
      api.verify.$post({ json, param: { inviteToken } }, { headers, init: { signal } }),
      "凭据验证失败，请重新验证或联系 HR。",
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export function credentialErrorMessage(error: unknown) {
  if (error instanceof Error || error instanceof DOMException) {
    const cause = error instanceof Error ? error.cause : undefined;
    const name = cause instanceof Error || cause instanceof DOMException ? cause.name : error.name;
    if (["NotAllowedError", "AbortError"].includes(name)) {
      return "验证已取消或超时，也可能未找到可用凭据。请重试；首次使用可选择创建，仍无法完成时请联系 HR。";
    }
    if (["SecurityError", "InvalidStateError", "NotSupportedError"].includes(name)) {
      return "当前浏览器或凭据管理器无法完成此操作，请使用兼容的浏览器重试，或联系 HR。";
    }
    return error.message;
  }
  return "无法完成凭据验证，请重试或联系 HR。";
}
