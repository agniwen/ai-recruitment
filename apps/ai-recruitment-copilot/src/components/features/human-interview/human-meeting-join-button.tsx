import type {
  PublicHumanInterviewInterviewerPreview,
  PublicHumanInterviewMeetingPreview,
} from "@arc/shared/studio-pipeline-stages";
import { IconLogin, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { checkMeetingMicrophone, microphoneErrorHelp } from "./human-meeting-microphone-check";

export function MeetingJoinButton({
  disabled,
  isJoining,
  label,
  onCheckError,
  onJoin,
  preview,
}: {
  disabled: boolean;
  isJoining: boolean;
  label: string;
  onCheckError: (error: Error) => void;
  onJoin: (microphoneError: Error | null) => Promise<void>;
  preview: PublicHumanInterviewMeetingPreview | PublicHumanInterviewInterviewerPreview;
}) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<Error | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const entryAllowed = useRef(!disabled);
  const retryButton = useRef<HTMLButtonElement>(null);
  const needsMicrophone = !("role" in preview && preview.role === "observer");
  const pending = checking || isJoining;
  const errorHelp = checkError ? microphoneErrorHelp(checkError) : null;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    entryAllowed.current = !disabled;
  }, [disabled]);

  async function join(skipCheck: boolean) {
    if (disabled || isJoining || inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      if (needsMicrophone && !skipCheck) {
        setChecking(true);
        const error = await checkMeetingMicrophone();
        if (!active.current || !entryAllowed.current) {
          return;
        }
        setChecking(false);
        setCheckError(error);
        if (error) {
          onCheckError(error);
          setDialogOpen(true);
          return;
        }
      }
      setDialogOpen(false);
      await onJoin(skipCheck ? checkError : null);
    } finally {
      inFlight.current = false;
      if (active.current) {
        setChecking(false);
      }
    }
  }

  return (
    <>
      <Button
        className="min-w-36"
        disabled={disabled || pending}
        onClick={() => void join(false)}
        size="lg"
      >
        {pending ? <Spinner data-icon="inline-start" /> : <IconLogin data-icon="inline-start" />}
        {checking ? "正在检测麦克风…" : label}
      </Button>
      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open, details) => {
          if (pending) {
            details.cancel();
            return;
          }
          setDialogOpen(open);
        }}
      >
        <AlertDialogContent aria-busy={pending} initialFocus={retryButton}>
          <AlertDialogCancel
            aria-label="关闭麦克风提示"
            className="absolute right-2 top-2"
            disabled={pending}
            size="icon-sm"
            variant="ghost"
          >
            <IconX />
          </AlertDialogCancel>
          <AlertDialogHeader>
            <AlertDialogTitle className="pr-6">{errorHelp?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {errorHelp?.help}{" "}
              调整后可以重新检测，也可以先进入会议。麦克风不可用时，其他人暂时听不到你；入会后仍可手动开启。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              disabled={disabled || pending}
              variant="outline"
              onClick={() => void join(true)}
            >
              仍然进入（麦克风不可用）
            </AlertDialogAction>
            <AlertDialogAction
              ref={retryButton}
              disabled={disabled || pending}
              onClick={() => void join(false)}
            >
              {checking ? <Spinner data-icon="inline-start" /> : null}
              {checking ? "检测中…" : "重新检测"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
