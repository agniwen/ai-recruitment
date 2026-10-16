import { useEffect, useRef, useState } from "react";
import type { IpReference } from "@arc/shared/platform-security";
import { Button } from "@/components/ui/button";
import { redirectToPlatformMfa } from "@/lib/client/platform-mfa";
import { needsMfa, revealIp } from "./api";

interface IpRevealProps {
  reference: IpReference;
  hasIp: boolean;
}

function IpRevealValue({ reference, hasIp }: IpRevealProps) {
  const [visible, setVisible] = useState<{ ip: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const { id, kind, meetingId } = reference;
  useEffect(() => {
    function clear() {
      request.current?.abort();
      setVisible(null);
      setBusy(false);
    }
    function onVisibility() {
      if (document.hidden) {
        clear();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", clear);
    return () => {
      request.current?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", clear);
    };
  }, [id, kind, meetingId]);
  useEffect(() => {
    if (!visible) {
      return;
    }
    const timeout = window.setTimeout(
      () => setVisible(null),
      Math.max(0, Math.min(60_000, Date.parse(visible.expiresAt) - Date.now())),
    );
    return () => window.clearTimeout(timeout);
  }, [visible]);

  async function showIp() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await revealIp({ id, kind, meetingId }, controller.signal);
      if (!controller.signal.aborted && Date.parse(result.expiresAt) > Date.now()) {
        setVisible(result);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (needsMfa(error)) {
        redirectToPlatformMfa();
      } else {
        setError(error instanceof Error ? error.message : "无法查看 IP");
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }

  if (!hasIp) {
    return <span>IP 未采集</span>;
  }
  return (
    <div className="space-y-1">
      {visible ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono">{visible.ip}</span>
          <Button size="sm" variant="ghost" onClick={() => setVisible(null)}>
            隐藏
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void showIp();
          }}
        >
          {busy ? "读取中…" : "查看 IP"}
        </Button>
      )}
      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function IpReveal(props: IpRevealProps) {
  return (
    <IpRevealValue
      key={`${props.reference.kind}:${props.reference.meetingId}:${props.reference.id}`}
      {...props}
    />
  );
}
