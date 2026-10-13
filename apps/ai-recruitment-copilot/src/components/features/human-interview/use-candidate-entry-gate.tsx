import { useEffect, useRef, useState } from "react";
import type { EntryCredentialRegistration } from "@arc/shared/entry-credentials";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { credentialErrorMessage, verifyCandidateCredential } from "./entry-credential-api";

interface EntryGateProps {
  inviteToken: string;
  required: boolean;
  headers: () => Record<string, string>;
  join: (microphoneError: Error | null, proof?: string) => Promise<void>;
  recheck: () => Promise<boolean>;
  onFailure: (errorName: string) => void;
}

export function useCandidateEntryGate({
  inviteToken,
  required,
  headers,
  join,
  recheck,
  onFailure,
}: EntryGateProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setError] = useState<string | null>(null);
  const [registrationState, setRegistrationState] = useState<{
    inviteToken: string;
    registration: EntryCredentialRegistration;
  } | null>(null);
  const registration =
    registrationState?.inviteToken === inviteToken ? registrationState.registration : null;
  const proof = useRef<string | null>(null);
  const microphoneError = useRef<Error | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      proof.current = null;
    },
    [inviteToken],
  );

  async function run(kind: "register" | "authenticate" | "recheck") {
    if (pending.current || (kind === "register" && !registration?.canCreate)) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      if (kind === "recheck") {
        const allowed = await recheck();
        if (!allowed) {
          throw new Error("当前仍需验证或暂不可入会。无法完成验证时，请联系 HR 协助处理后再检查。");
        }
      } else {
        const result = await verifyCandidateCredential(
          inviteToken,
          kind,
          headers(),
          controller.signal,
          (state) => {
            if (!controller.signal.aborted) {
              setRegistrationState({ inviteToken, registration: state });
            }
          },
        );
        controller.signal.throwIfAborted();
        proof.current = result.proof;
      }
      controller.signal.throwIfAborted();
      setOpen(false);
      await join(microphoneError.current, proof.current ?? undefined);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(credentialErrorMessage(error));
        if (kind !== "recheck") {
          onFailure(
            error instanceof Error || error instanceof DOMException ? error.name : "unknown_error",
          );
        }
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  async function beginJoin(captureError: Error | null) {
    if (open || pending.current) {
      return;
    }
    if (required && !proof.current) {
      microphoneError.current = captureError;
      setError(null);
      setOpen(true);
      await run("authenticate");
      return;
    }
    await join(captureError, proof.current ?? undefined);
  }

  let registrationMessage = "尚未获取创建次数，请重新验证后再试。";
  if (registration) {
    registrationMessage = registration.canCreate
      ? ""
      : `本场面试已创建 ${registration.createdCount}/${registration.limit} 个入场凭据，已达创建上限。请使用已有凭据验证，或联系 HR。`;
  }

  return {
    beginJoin,
    dialog: open ? (
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
          }
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>验证入场凭据</DialogTitle>
            <DialogDescription>请在系统通行密钥窗口中完成入场验证。</DialogDescription>
          </DialogHeader>
          {errorMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          {busy ? (
            <output className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> 正在验证，请稍候…
            </output>
          ) : (
            <div className="flex flex-col gap-2">
              {!registration || registration.createdCount > 0 ? (
                <Button onClick={() => void run("authenticate")}>重新验证</Button>
              ) : null}
              {registration?.canCreate ? (
                <Button
                  variant={registration.createdCount > 0 ? "outline" : "default"}
                  onClick={() => void run("register")}
                >
                  创建凭证进入面试
                </Button>
              ) : null}
              {registrationMessage ? (
                <p className="text-sm text-muted-foreground">{registrationMessage}</p>
              ) : null}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            无法完成？请联系 HR 协助处理，处理后点击“重新检查入会要求”。
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                if (pending.current) {
                  onFailure("AbortError");
                }
                pending.current?.abort();
                setOpen(false);
              }}
            >
              返回
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run("recheck");
              }}
            >
              重新检查入会要求
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null,
    requireCredential: (captureError: Error | null) => {
      proof.current = null;
      microphoneError.current = captureError;
      setError(null);
      setOpen(true);
    },
  };
}
