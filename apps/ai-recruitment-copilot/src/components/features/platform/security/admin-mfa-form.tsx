import { useEffect, useId, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { MfaStatus } from "@arc/shared/platform-security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  enrollMfa,
  fetchMfaStatus,
  needsMfa,
  replaceMfa,
  verifyMfaCode,
  verifyMfaReplacement,
} from "./api";

type Purpose = "access" | "replacement";
interface Enrollment {
  kind: "initial" | "replacement";
  secret: string;
  uri: string;
}
const codeMethods = {
  recovery: {
    alternate: "totp",
    alternateLabel: "使用验证器",
    inputMode: "text",
    label: "一次性恢复码",
    maxLength: 32,
    pattern: "[a-fA-F0-9]{32}",
  },
  totp: {
    alternate: "recovery",
    alternateLabel: "使用恢复码",
    inputMode: "numeric",
    label: "六位验证码",
    maxLength: 6,
    pattern: "[0-9]{6}",
  },
} as const;

function shouldPrepareEnrollment(status: MfaStatus, purpose: Purpose) {
  return (
    !status.enrolled ||
    (purpose === "replacement" &&
      Boolean(status.expiresAt && Date.parse(status.expiresAt) > Date.now()))
  );
}
async function prepareEnrollment(status: MfaStatus, purpose: Purpose): Promise<Enrollment> {
  const kind = purpose === "replacement" && status.enrolled ? "replacement" : "initial";
  const details = await (kind === "replacement" ? replaceMfa() : enrollMfa());
  return { ...details, kind };
}

function RecoveryCodes({
  codes,
  onContinue,
}: {
  codes: string[];
  onContinue: () => void | Promise<void>;
}) {
  const savedId = useId();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setError] = useState("");
  async function continueToBackend() {
    setBusy(true);
    setError("");
    try {
      await onContinue();
    } catch (error) {
      setError(error instanceof Error ? error.message : "暂时无法进入后台，请重试");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        验证器已绑定。请安全保存以下恢复码，每个码只能用一次，页面关闭后不能再次查看。更换验证器后，原恢复码失效。
      </p>
      <div className="space-y-1 rounded-md border p-3 font-mono text-xs" aria-label="恢复码">
        {codes.map((value) => (
          <p key={value}>{value}</p>
        ))}
      </div>
      <label htmlFor={savedId} className="flex items-center gap-2 text-sm">
        <input
          id={savedId}
          type="checkbox"
          aria-label="我已安全保存恢复码"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        我已安全保存恢复码
      </label>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      <Button
        disabled={!saved || busy}
        onClick={() => {
          void continueToBackend();
        }}
      >
        {busy ? "正在进入后台…" : "继续"}
      </Button>
    </div>
  );
}

export function AdminMfaForm({
  onVerified,
  purpose = "access",
}: {
  onVerified: () => void | Promise<void>;
  purpose?: Purpose;
}) {
  const codeId = useId();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [errorMessage, setError] = useState("");
  const codeMethod = codeMethods[method];
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetchMfaStatus(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setStatus(result);
        if (purpose === "access" && result.expiresAt && Date.parse(result.expiresAt) > Date.now()) {
          await onVerified();
          return;
        }
        if (shouldPrepareEnrollment(result, purpose)) {
          const details = await prepareEnrollment(result, purpose);
          if (!controller.signal.aborted) {
            setEnrollment(details);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "加载验证状态失败");
        }
      } finally {
        if (!controller.signal.aborted) {
          setBusy(false);
        }
      }
    }
    void load();
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [onVerified, purpose]);

  async function beginEnrollment() {
    if (!status) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const details = await prepareEnrollment(status, purpose);
      if (active.current) {
        setEnrollment(details);
        setMethod("totp");
        setCode("");
      }
    } catch (error) {
      if (active.current) {
        setError(error instanceof Error ? error.message : "绑定失败");
      }
    } finally {
      if (active.current) {
        setBusy(false);
      }
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const result = await (enrollment?.kind === "replacement"
        ? verifyMfaReplacement(code.trim())
        : verifyMfaCode({ code: code.trim(), method }));
      if (!active.current) {
        return;
      }
      setCode("");
      if (purpose === "replacement" && !enrollment) {
        const nextStatus = { enrolled: true, expiresAt: result.expiresAt };
        setStatus(nextStatus);
        const details = await prepareEnrollment(nextStatus, purpose);
        if (active.current) {
          setEnrollment(details);
          setMethod("totp");
        }
        return;
      }
      setEnrollment(null);
      if (result.recoveryCodes.length) {
        setRecoveryCodes(result.recoveryCodes);
      } else {
        await onVerified();
      }
    } catch (error) {
      if (!active.current) {
        return;
      }
      setCode("");
      if (needsMfa(error) && purpose === "replacement") {
        setEnrollment(null);
        setStatus({ enrolled: true, expiresAt: null });
      }
      setError(error instanceof Error ? error.message : "验证失败，请重试");
    } finally {
      if (active.current) {
        setBusy(false);
      }
    }
  }

  if (recoveryCodes.length) {
    return <RecoveryCodes codes={recoveryCodes} onContinue={onVerified} />;
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        两步验证仅用于进入平台管理后台，不改变日常账号登录。请使用 Google Authenticator、Microsoft
        Authenticator 等验证器。持续操作后台会自动续期，闲置 15 分钟后需要重新验证。
      </p>
      {purpose === "replacement" ? (
        <p className="text-sm">
          新验证器确认成功前，原验证器继续有效。授权过期时，请先验证当前验证器，再绑定新的验证器。
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {status ? null : <p className="text-sm">正在加载验证状态…</p>}
      {enrollment ? (
        <div className="space-y-3">
          <p className="text-sm">
            用验证器扫描二维码，再输入生成的六位验证码。请勿分享二维码或密钥。
          </p>
          <div className="inline-block bg-white p-3">
            <QRCodeSVG value={enrollment.uri} size={192} title="身份验证器绑定二维码" />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer">无法扫码？手动输入密钥</summary>
            <code className="block break-all py-2">{enrollment.secret}</code>
            <p>选择“基于时间”，账号名称可填写“ARC 平台后台”。</p>
          </details>
        </div>
      ) : null}
      {status?.enrolled || enrollment ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={codeId}>{codeMethod.label}</Label>
          <Input
            id={codeId}
            autoComplete="one-time-code"
            inputMode={codeMethod.inputMode}
            maxLength={codeMethod.maxLength}
            pattern={codeMethod.pattern}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !code}>
            {busy ? "验证中…" : "验证并继续"}
          </Button>
          {status?.enrolled && !enrollment ? (
            <Button
              type="button"
              variant="link"
              disabled={busy}
              onClick={() => {
                setCode("");
                setError("");
                setMethod(codeMethod.alternate);
              }}
            >
              {codeMethod.alternateLabel}
            </Button>
          ) : null}
        </form>
      ) : null}
      {status && shouldPrepareEnrollment(status, purpose) ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void beginEnrollment();
          }}
        >
          {busy ? "准备中…" : "重新加载绑定二维码"}
        </Button>
      ) : null}
    </div>
  );
}
