import type { IpReference, MfaCode, MfaStatus } from "@arc/shared/platform-security";
import { rpc } from "@/lib/client/rpc";
import { ApiError, rpcFetch } from "@/lib/client/api";
import { isMfaRequiredPayload } from "@/lib/client/platform-mfa";

export function needsMfa(error: unknown) {
  return error instanceof ApiError && isMfaRequiredPayload(error.payload);
}

export function fetchMfaStatus(signal: AbortSignal) {
  return rpcFetch<MfaStatus>(
    rpc.api.security.mfa.$get({}, { init: { cache: "no-store", signal } }),
    "加载验证状态失败",
  );
}
export function renewMfaActivity(activeAt: number, signal: AbortSignal) {
  return rpcFetch<{ expiresAt: string }>(
    rpc.api.security.mfa.activity.$post(
      { json: { activeAt } },
      { init: { cache: "no-store", signal } },
    ),
    "无法更新后台验证状态",
  );
}
export function enrollMfa() {
  return rpcFetch<{ secret: string; uri: string }>(
    rpc.api.security.mfa.enroll.$post(),
    "无法开始绑定验证器",
  );
}
export function verifyMfaCode(input: MfaCode) {
  return rpcFetch<{ expiresAt: string; recoveryCodes: string[] }>(
    rpc.api.security.mfa.verify.$post({ json: input }),
    "两步验证失败",
  );
}
export function replaceMfa() {
  return rpcFetch<{ secret: string; uri: string }>(
    rpc.api.security.mfa.replacement.$post(),
    "无法开始更换验证器",
  );
}
export function verifyMfaReplacement(code: string) {
  return rpcFetch<{ expiresAt: string; recoveryCodes: string[] }>(
    rpc.api.security.mfa.replacement.verify.$post({ json: { code } }),
    "无法确认新验证器",
  );
}
export function revealIp(input: IpReference, signal: AbortSignal) {
  return rpcFetch<{ ip: string; expiresAt: string }>(
    rpc.api.platform["interview-logs"].ip.reveal.$post(
      { json: input },
      { init: { cache: "no-store", signal } },
    ),
    "无法查看 IP",
  );
}
