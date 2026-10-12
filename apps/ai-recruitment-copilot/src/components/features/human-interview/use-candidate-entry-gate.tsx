import { useEffect, useRef, useState } from "react";
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

  async function beginJoin(captureError: Error | null) {
    if (open || pending.current) {
      return;
    }
    if (required && !proof.current) {
      microphoneError.current = captureError;
      setError(null);
      setOpen(true);
      return;
    }
    await join(captureError, proof.current ?? undefined);
  }

  async function run(kind: "register" | "authenticate" | "recheck") {
    if (pending.current) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      if (kind === "recheck") {
        if (!(await recheck())) {
          throw new Error("当前仍需验证或暂不可入会。无法完成验证时，请联系 HR 协助处理后再检查。");
        }
      } else {
        const result = await verifyCandidateCredential(
          inviteToken,
          kind,
          headers(),
          controller.signal,
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
            <DialogDescription>
              请通过系统通行密钥确认入场。已有凭据请选择验证；首次使用请选择创建，并按系统提示完成操作。
            </DialogDescription>
          </DialogHeader>
          {errorMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                void run("authenticate");
              }}
            >
              {busy ? <Spinner /> : null}使用已有凭据验证
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run("register");
              }}
            >
              首次使用，创建入场凭据
            </Button>
          </div>
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
