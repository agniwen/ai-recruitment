import { useConnectionState, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { IconLoader2, IconMicrophoneOff } from "@tabler/icons-react";
import { ConnectionState, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { microphoneErrorHelp } from "./human-meeting-microphone-check";

export function useMeetingMicrophone(canPublish: boolean, preflightError: Error | null = null) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { isMicrophoneEnabled } = useLocalParticipant();
  const [microphoneError, setError] = useState<Error | null>(preflightError);
  const [pending, setPending] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const attempted = useRef(false);
  const connected = connectionState === ConnectionState.Connected;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onError = useCallback((cause: Error) => {
    if (mounted.current) {
      setError(cause);
    }
  }, []);

  const enableMicrophone = useCallback(async () => {
    if (!canPublish || !connected || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      await room.localParticipant.setMicrophoneEnabled(
        true,
        publication ? undefined : { deviceId: "default" },
      );
    } catch (error) {
      onError(
        error instanceof Error || error instanceof DOMException
          ? error
          : new Error("麦克风开启失败"),
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setPending(false);
      }
    }
  }, [canPublish, connected, onError, room]);

  useEffect(() => {
    if (canPublish && connected && !attempted.current) {
      attempted.current = true;
      if (!isMicrophoneEnabled && !preflightError) {
        void enableMicrophone();
      }
    }
    // Reconnects and manual mute must never automatically turn the microphone back on.
  }, [canPublish, connected, enableMicrophone, isMicrophoneEnabled, preflightError]);

  useEffect(() => {
    if (isMicrophoneEnabled) {
      setError(null);
    }
  }, [isMicrophoneEnabled]);

  return {
    enableMicrophone,
    error: microphoneError,
    onError,
    pending,
    showNotice: canPublish && connected && !isMicrophoneEnabled,
  };
}

export function MeetingMicrophoneNotice({
  microphone,
}: {
  microphone: ReturnType<typeof useMeetingMicrophone>;
}) {
  if (!microphone.showNotice) {
    return null;
  }
  let title = "麦克风已关闭";
  let help = "需要发言时，请点击开启麦克风；如果已经开启但仍无声，请检查设备的静音开关和输入音量。";
  if (microphone.pending) {
    title = "正在开启麦克风";
    help = "请在浏览器提示中允许使用麦克风。";
  } else if (microphone.error) {
    ({ title, help } = microphoneErrorHelp(microphone.error));
  }
  return (
    <div
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-300/20 bg-amber-950/40 px-4 py-3 text-amber-100"
    >
      <IconMicrophoneOff aria-hidden="true" className="size-5 shrink-0" />
      <div className="min-w-0 flex-1 basis-60 text-sm">
        <p className="font-medium">{title} · 其他人暂时听不到你</p>
        <p className="mt-1 text-xs leading-5 text-amber-100/80">{help}</p>
      </div>
      <button
        type="button"
        disabled={microphone.pending}
        onClick={() => void microphone.enableMicrophone()}
        className="inline-flex items-center gap-2 rounded-md border border-amber-200/30 px-3 py-2 text-sm hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:cursor-wait disabled:opacity-60"
      >
        {microphone.pending ? (
          <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : null}
        {microphone.pending ? "开启中…" : "开启麦克风"}
      </button>
    </div>
  );
}
