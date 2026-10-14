"use client";

import {
  IconDeviceDesktopUp,
  IconMessage,
  IconLoader2,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconPlayerStop,
  IconUsers,
  IconVideo,
  IconVideoOff,
} from "@tabler/icons-react";
/* oxlint-disable no-use-before-define -- exported room wrapper stays above local stage helpers. */

import {
  DisconnectButton,
  ConnectionQualityIndicator,
  ParticipantName,
  TrackMutedIndicator,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  StartAudio,
  TrackLoop,
  TrackToggle,
  useTrackRefContext,
  useParticipants,
  useIsSpeaking,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";

import { DisconnectReason, Track, VideoPresets, ScreenSharePresets } from "livekit-client";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useReducer, useState } from "react";
import { toast } from "sonner";
import type {
  HumanInterviewMeetingTokenResponse,
  PublicHumanInterviewInterviewerPreview,
  PublicHumanInterviewMeetingPreview,
} from "@arc/shared/studio-pipeline-stages";
import { cn } from "@arc/shared/utils";
import { useQuery } from "@tanstack/react-query";
import { TimeDisplay } from "@/components/features/display/time-display";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MicrophoneDeviceMenu, VoiceEffectMenu } from "./human-meeting-audio-controls";

import {
  tokenErrorCode,
  fetchMeetingPreview,
  fetchCandidateToken,
  fetchInterviewerToken,
  endInterviewerMeeting,
} from "./human-meeting-api";
import { getMeetingPollInterval } from "./human-meeting-polling";
import { MeetingJoinButton } from "./human-meeting-join-button";
import { useCandidateEntryGate } from "./use-candidate-entry-gate";
import { HumanMeetingChat } from "./human-meeting-chat";
import { useMeetingTelemetry } from "./use-meeting-telemetry";
import { MeetingTelemetryObserver } from "./meeting-telemetry-observer";
import { MeetingMicrophoneNotice, useMeetingMicrophone } from "./human-meeting-microphone";

type HumanMeetingRoomProps =
  | {
      inviteToken: string;
      mode: "candidate";
      preview: PublicHumanInterviewMeetingPreview;
    }
  | {
      inviteToken: string;
      mode: "interviewer";
      preview: PublicHumanInterviewInterviewerPreview;
    };

const interviewerRoleLabel = {
  host: "主持人",
  interviewer: "面试官",
  observer: "旁听",
} as const;
function getRoomTitle(props: HumanMeetingRoomProps): string {
  return props.preview.title;
}

function getRoomSubtitle(props: HumanMeetingRoomProps): string {
  if (props.mode === "candidate") {
    return `${props.preview.candidateName} · ${props.preview.roundLabel}`;
  }
  return `${props.preview.interviewerName} · ${interviewerRoleLabel[props.preview.role]}`;
}

function candidateRequiresCredential(
  mode: HumanMeetingRoomProps["mode"],
  preview: HumanMeetingRoomProps["preview"],
) {
  return (
    mode === "candidate" &&
    "candidateCredentialRequired" in preview &&
    preview.candidateCredentialRequired === true
  );
}

interface ParticipantMetadata {
  participant_role?: string;
  participant_type?: string;
}

function parseParticipantMetadata(metadata: string | undefined): ParticipantMetadata {
  if (!metadata) {
    return {};
  }
  try {
    return JSON.parse(metadata) as ParticipantMetadata;
  } catch {
    return {};
  }
}

function getParticipantBadge(trackRef: TrackReferenceOrPlaceholder): {
  label: string;
  tone: "candidate" | "interviewer";
} {
  const metadata = parseParticipantMetadata(trackRef.participant.metadata);
  const { identity, name: participantName } = trackRef.participant;
  let role = metadata.participant_role;
  if (metadata.participant_type === "candidate" || identity.startsWith("candidate_")) {
    role = "candidate";
  }

  let roleLabel = "面试官";
  if (role === "candidate") {
    roleLabel = "候选人";
  } else if (role === "host") {
    roleLabel = "主持人";
  } else if (role === "observer") {
    roleLabel = "旁听";
  }
  const name = participantName || identity;
  const sourceSuffix = trackRef.source === Track.Source.ScreenShare ? " · 屏幕共享" : "";

  return {
    label: `${roleLabel} · ${name}${sourceSuffix}`,
    tone: role === "candidate" ? "candidate" : "interviewer",
  };
}

async function loadMeetingToken(
  props: HumanMeetingRoomProps,
  headers: Record<string, string>,
): Promise<
  | { token: HumanInterviewMeetingTokenResponse; error: null }
  | { token: null; error: string; errorCode: number | string }
> {
  try {
    const token =
      props.mode === "candidate"
        ? await fetchCandidateToken(props.inviteToken, headers)
        : await fetchInterviewerToken(props.inviteToken, headers);
    return { error: null, token };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "进入会议失败",
      errorCode: tokenErrorCode(error),
      token: null,
    };
  }
}

async function finishInterviewerMeeting(
  inviteToken: string,
  headers: Record<string, string>,
): Promise<{ error: string | null }> {
  try {
    await endInterviewerMeeting(inviteToken, headers);
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "结束会议失败",
    };
  }
}

async function runEndMeeting(onEndMeeting: () => Promise<void> | void): Promise<boolean> {
  try {
    await onEndMeeting();
    return true;
  } catch {
    return false;
  }
}

interface MeetingRoomState {
  isEnding: boolean;
  isJoining: boolean;
  joinError: string | null;
  microphonePreflightError: Error | null;
  token: HumanInterviewMeetingTokenResponse | null;
}

type MeetingRoomAction =
  | { type: "disconnected" }
  | { type: "endingFinished" }
  | { type: "endingStarted" }
  | { message: string; type: "joinFailed" }
  | {
      token: HumanInterviewMeetingTokenResponse;
      microphonePreflightError: Error | null;
      type: "joinSucceeded";
    }
  | { type: "joinStarted" }
  | { message: string; type: "roomError" };

const initialMeetingRoomState: MeetingRoomState = {
  isEnding: false,
  isJoining: false,
  joinError: null,
  microphonePreflightError: null,
  token: null,
};

function meetingRoomReducer(state: MeetingRoomState, action: MeetingRoomAction): MeetingRoomState {
  switch (action.type) {
    case "disconnected": {
      return { ...state, token: null };
    }
    case "endingFinished": {
      return { ...state, isEnding: false };
    }
    case "endingStarted": {
      return { ...state, isEnding: true };
    }
    case "joinFailed":
    case "roomError": {
      return { ...state, isJoining: false, joinError: action.message };
    }
    case "joinStarted": {
      return { ...state, isJoining: true, joinError: null };
    }
    case "joinSucceeded": {
      return {
        ...state,
        isJoining: false,
        microphonePreflightError: action.microphonePreflightError,
        token: action.token,
      };
    }
    default: {
      return state;
    }
  }
}

export function HumanMeetingRoom(props: HumanMeetingRoomProps) {
  const telemetry = useMeetingTelemetry(props.mode, props.inviteToken);
  const [state, dispatch] = useReducer(meetingRoomReducer, initialMeetingRoomState);
  const { isEnding, isJoining, joinError, token } = state;
  const accessQuery = useQuery({
    enabled: !token,
    gcTime: 0,
    initialData: props.preview,
    queryFn: () => fetchMeetingPreview(props.mode, props.inviteToken),
    queryKey: ["human-meeting-preview", props.mode, props.inviteToken],
    // The server supplies a duration, so a wrong device clock cannot lock entry.
    refetchInterval: (query) =>
      getMeetingPollInterval(
        query.state.status === "error" ? null : query.state.data?.entryAccess.recheckAfterMs,
      ),
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    retry: false,
    staleTime: 0,
  });
  const preview = accessQuery.data;
  const { entryAccess } = preview;
  const entryBlocked = accessQuery.isError || !entryAccess.canJoin;
  const tooEarly = entryAccess.reason === "too_early";
  const { refetch } = accessQuery;
  useEffect(() => {
    if (token) {
      return;
    }
    const checkOnFocus = () => {
      void refetch();
    };
    window.addEventListener("focus", checkOnFocus);
    return () => window.removeEventListener("focus", checkOnFocus);
  }, [refetch, token]);

  const credentialGate = useCandidateEntryGate({
    headers: telemetry.headers,
    inviteToken: props.inviteToken,
    join: joinMeeting,
    onFailure: (errorName) => {
      telemetry.emit("entry_credential_client_failed", { errorName });
      telemetry.flush();
    },
    recheck: async () => {
      const result = await accessQuery.refetch();
      return (
        !result.isError &&
        result.data?.entryAccess.canJoin === true &&
        !("candidateCredentialRequired" in result.data && result.data.candidateCredentialRequired)
      );
    },
    required: candidateRequiresCredential(props.mode, preview),
  });

  async function joinMeeting(microphonePreflightError: Error | null, proof?: string) {
    if (entryBlocked) {
      return;
    }
    dispatch({ type: "joinStarted" });
    telemetry.startAttempt();
    const headers: Record<string, string> = telemetry.headers();
    if (props.mode === "candidate" && proof) {
      headers["x-interview-entry-proof"] = proof;
    }
    const result = await loadMeetingToken(props, headers);
    if (result.token) {
      dispatch({ microphonePreflightError, token: result.token, type: "joinSucceeded" });
      return;
    }
    void accessQuery.refetch();
    dispatch({ message: result.error, type: "joinFailed" });
    if (props.mode === "candidate" && result.errorCode === "ENTRY_CREDENTIAL_REQUIRED") {
      credentialGate.requireCredential(microphonePreflightError);
      return;
    }
    telemetry.emit("join_failed", { errorCode: result.errorCode });
    toast.error(result.error);
  }

  async function endMeeting(): Promise<void> {
    if (props.mode !== "interviewer") {
      return;
    }
    dispatch({ type: "endingStarted" });
    telemetry.emit("end_requested");
    const result = await finishInterviewerMeeting(props.inviteToken, telemetry.headers());
    dispatch({ type: "endingFinished" });
    if (result.error) {
      telemetry.emit("end_failed");
      toast.error(result.error);
      throw new Error(result.error);
    }
    toast.success("会议已结束");
    telemetry.emit("end_completed");
    telemetry.flush();
    dispatch({ type: "disconnected" });
  }

  if (!token) {
    let entryMessage = joinError;
    if (entryAccess.reason === "closed") {
      entryMessage = "该真人复面会议已结束或取消。";
    } else if (entryAccess.reason === "expired") {
      entryMessage = "该真人复面会议已超过有效时间。";
    }
    if (accessQuery.isError) {
      entryMessage = "检查入会状态失败，请重试。";
    }
    let joinButtonText = "进入会议";
    if (entryBlocked) {
      joinButtonText = tooEarly && !accessQuery.isError ? "未到入会时间" : "暂不可入会";
    } else if (isJoining) {
      joinButtonText = "连接中…";
    }

    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
        <section className="w-full max-w-lg space-y-6 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-muted/60 bg-muted/30">
            <IconVideo className="size-6 text-foreground" />
          </div>
          <div className="space-y-2">
            <h1 className="font-semibold text-2xl tracking-normal">{getRoomTitle(props)}</h1>
            <p className="text-muted-foreground text-sm">
              {getRoomSubtitle(props)} ·{" "}
              <TimeDisplay
                value={preview.scheduledAt}
                options="YYYY/MM/DD HH:mm"
                emptyText="时间未定"
              />
              （北京时间）
            </p>
          </div>
          {tooEarly && !accessQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              面试时间为 <TimeDisplay value={preview.scheduledAt} options="YYYY/MM/DD HH:mm" />
              （北京时间），可提前 10 分钟进入，当前暂不能进入会议。
            </p>
          ) : null}
          {entryMessage && (!tooEarly || accessQuery.isError) ? (
            <p className="text-sm text-destructive">{entryMessage}</p>
          ) : null}
          <MeetingJoinButton
            disabled={entryBlocked}
            isJoining={isJoining}
            label={joinButtonText}
            preview={preview}
            onJoin={credentialGate.beginJoin}
            onCheckError={(error) => {
              telemetry.emit("media_device_error", {
                deviceKind: "audioinput",
                errorName: error.name,
                reason: "pre_join_check",
              });
              telemetry.flush();
            }}
          />
          {props.mode === "candidate" ? credentialGate.dialog : null}
          {entryBlocked ? (
            <div>
              <Button
                variant="ghost"
                disabled={accessQuery.isFetching}
                onClick={() => {
                  void accessQuery.refetch();
                }}
              >
                {accessQuery.isFetching ? "检查中…" : "检查入会状态"}
              </Button>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <LiveKitRoom
      audio={false}
      className="dark human-meeting-theme h-dvh overflow-hidden bg-zinc-950 text-white"
      connect
      onDisconnected={(reason) => {
        telemetry.emit("disconnected", {
          reason: reason === undefined ? "UNKNOWN_REASON" : DisconnectReason[reason],
        });
        telemetry.flush();
        dispatch({ type: "disconnected" });
      }}
      onError={(e) => {
        telemetry.emit("room_error", { errorName: e.name });
        dispatch({ message: e.message, type: "roomError" });
        toast.error(e.message);
      }}
      serverUrl={token.serverUrl}
      token={token.participantToken}
      video={false}
    >
      <MeetingTelemetryObserver telemetry={telemetry} />
      <HumanMeetingStage
        chatInviteToken={props.inviteToken}
        chatMode={props.mode}
        canPublish={token.participantRole !== "observer"}
        canUseVoiceEffects={props.mode === "interviewer" && token.participantRole !== "observer"}
        canEndMeeting={props.mode === "interviewer"}
        isEnding={isEnding}
        microphonePreflightError={state.microphonePreflightError}
        onEndMeeting={endMeeting}
        onLeave={() => {
          telemetry.emit("leave_clicked");
          telemetry.flush();
        }}
        participantName={token.participantName}
        title={getRoomTitle(props)}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function HumanMeetingStage({
  chatInviteToken,
  chatMode,
  canPublish,
  canUseVoiceEffects,
  canEndMeeting,
  isEnding,
  microphonePreflightError,
  onEndMeeting,
  onLeave,
  participantName,
  title,
}: {
  chatInviteToken: string;
  chatMode: "candidate" | "interviewer";
  canPublish: boolean;
  canUseVoiceEffects: boolean;
  canEndMeeting: boolean;
  isEnding: boolean;
  microphonePreflightError: Error | null;
  onEndMeeting: () => Promise<void> | void;
  onLeave: () => void;
  participantName: string;
  title: string;
}) {
  const microphone = useMeetingMicrophone(canPublish, microphonePreflightError);
  const [chatOpen, setChatOpen] = useState(false);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const [focusedTrackKey, setFocusedTrackKey] = useState<string | null>(null);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const participants = useParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  );

  const manuallyFocusedTrack = tracks.find((track) => meetingTrackKey(track) === focusedTrackKey);
  const focusedTrack =
    manuallyFocusedTrack ??
    tracks.find((track) => track.source === Track.Source.ScreenShare) ??
    tracks[0];
  const sideTracks = tracks.filter((track) => track !== focusedTrack);
  if (focusedTrackKey && !manuallyFocusedTrack) {
    setFocusedTrackKey(null);
  }

  async function handleEndConfirm(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const ended = await runEndMeeting(onEndMeeting);
    if (ended) {
      setEndConfirmOpen(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-white/10 border-b px-4 py-3">
        <div>
          <h1 className="font-medium text-xl text-white tracking-normal">{title}</h1>
          <p className="text-white/60 text-xs">{participantName}</p>
        </div>
        <Badge variant="inverse">
          <IconUsers data-icon="inline-start" />
          {participants.length}
        </Badge>
      </header>
      <MeetingMicrophoneNotice microphone={microphone} />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {focusedTrack ? (
          <div
            data-slot="meeting-focus-layout"
            className={cn(
              "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden p-3",
              sideTracks.length > 0
                ? "grid-rows-[minmax(0,1fr)_8rem] md:grid-cols-[minmax(0,1fr)_13rem] md:grid-rows-1"
                : "grid-cols-1 grid-rows-1",
            )}
          >
            <div className="min-h-0 min-w-0">
              <TrackLoop tracks={[focusedTrack]}>
                <HumanParticipantTile
                  onResetFocus={manuallyFocusedTrack ? () => setFocusedTrackKey(null) : undefined}
                />
              </TrackLoop>
            </div>
            {sideTracks.length > 0 ? (
              <aside
                aria-label="其他参会画面"
                className="grid min-h-0 min-w-0 auto-cols-[12rem] grid-flow-col gap-3 overflow-x-auto md:auto-cols-auto md:auto-rows-[8rem] md:grid-flow-row md:content-start md:overflow-x-hidden md:overflow-y-auto"
              >
                <TrackLoop tracks={sideTracks}>
                  <HumanParticipantTile onFocusTrack={setFocusedTrackKey} />
                </TrackLoop>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-white/60">等待参会画面…</div>
        )}
        <HumanMeetingChat
          access={{ inviteToken: chatInviteToken, mode: chatMode }}
          open={chatOpen}
          onClose={closeChat}
        />
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-white/10 border-t px-4 py-3">
        <button
          type="button"
          className={controlButtonClass}
          aria-expanded={chatOpen}
          onClick={() => setChatOpen((value) => !value)}
        >
          <IconMessage className="size-4" />
          聊天
        </button>
        {canPublish ? (
          <>
            <fieldset
              aria-label="麦克风控制"
              disabled={microphone.pending}
              className="inline-flex h-9 items-stretch overflow-hidden rounded-md border border-white/15 bg-white/10"
            >
              <TrackToggle
                className={cn(
                  mediaToggleButtonClass,
                  "h-full rounded-none border-0 bg-transparent",
                )}
                showIcon={false}
                source={Track.Source.Microphone}
                onDeviceError={microphone.onError}
              >
                <IconMicrophone className="toggle-on size-4" />
                <IconMicrophoneOff className="toggle-off size-4" />
                <span className="toggle-on">麦克风</span>
                <span className="toggle-off">已静音</span>
              </TrackToggle>
              <MicrophoneDeviceMenu onError={microphone.onError} />
            </fieldset>
            {canUseVoiceEffects ? <VoiceEffectMenu /> : null}
            <TrackToggle
              className={mediaToggleButtonClass}
              showIcon={false}
              captureOptions={{ resolution: VideoPresets.h720.resolution }}
              source={Track.Source.Camera}
            >
              <IconVideo className="toggle-on size-4" />
              <IconVideoOff className="toggle-off size-4" />
              <span className="toggle-on">摄像头</span>
              <span className="toggle-off">摄像头已关</span>
            </TrackToggle>
            <TrackToggle
              className={controlButtonClass}
              showIcon={false}
              captureOptions={{ resolution: ScreenSharePresets.h1080fps15.resolution }}
              source={Track.Source.ScreenShare}
            >
              <IconDeviceDesktopUp className="size-4" />
              共享屏幕
            </TrackToggle>
          </>
        ) : null}
        {canEndMeeting ? (
          <button
            className={endButtonClass}
            disabled={isEnding}
            onClick={() => setEndConfirmOpen(true)}
            type="button"
          >
            {isEnding ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconPlayerStop className="size-4" />
            )}
            {isEnding ? "结束中…" : "结束会议"}
          </button>
        ) : null}
        <StartAudio className={controlButtonClass} label="点击开启会议声音" />
        <DisconnectButton className={leaveButtonClass} onClick={onLeave}>
          <IconPhoneOff className="size-4" />
          离开
        </DisconnectButton>
      </footer>
      <AlertDialog onOpenChange={setEndConfirmOpen} open={endConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>结束这场会议？</AlertDialogTitle>
            <AlertDialogDescription>
              结束后会关闭当前视频房间，所有已加入的人都会离开，后续也不能继续进入该会议。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEnding}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={isEnding} onClick={handleEndConfirm} variant="destructive">
              {isEnding ? <IconLoader2 className="size-4 animate-spin" /> : null}
              确认结束
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function meetingTrackKey(track: TrackReferenceOrPlaceholder) {
  return `${track.participant.identity}:${track.source}`;
}

function HumanParticipantTile({
  onFocusTrack,
  onResetFocus,
}: {
  onFocusTrack?: (key: string) => void;
  onResetFocus?: () => void;
}) {
  const trackRef = useTrackRefContext();
  const badge = getParticipantBadge(trackRef);
  const isSpeaking = useIsSpeaking(trackRef.participant);
  const highlightSpeaker = isSpeaking && trackRef.source === Track.Source.Camera;

  return (
    <div
      data-speaking={highlightSpeaker}
      className={cn(
        "relative isolate h-full min-h-0 overflow-hidden rounded-lg border bg-zinc-900 transition-colors duration-200 motion-reduce:transition-none",
        highlightSpeaker ? "border-emerald-400" : "border-white/10",
      )}
    >
      <ParticipantTile
        className={cn(
          "relative h-full min-h-0 w-full overflow-hidden bg-zinc-900",
          "[&_.lk-focus-toggle-button]:hidden",
          "[&_.lk-participant-metadata]:hidden",
          "[&_.lk-participant-placeholder]:absolute [&_.lk-participant-placeholder]:inset-0 [&_.lk-participant-placeholder]:grid [&_.lk-participant-placeholder]:place-items-center [&_.lk-participant-placeholder]:bg-zinc-900",
          "[&_.lk-participant-placeholder_svg]:size-16 [&_.lk-participant-placeholder_svg]:text-white/25",
          "[&_video]:relative [&_video]:z-10 [&_video]:h-full [&_video]:w-full",
          trackRef.source === Track.Source.ScreenShare
            ? "[&_video]:object-contain"
            : "[&_video]:object-cover",
        )}
        trackRef={trackRef}
      />
      <div className="pointer-events-none absolute right-2 bottom-2 left-2 z-20 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-background/90 px-2 py-1 text-foreground">
          {trackRef.source === Track.Source.ScreenShare ? (
            <IconDeviceDesktopUp aria-label="屏幕共享" className="size-3.5 shrink-0" />
          ) : (
            <TrackMutedIndicator
              trackRef={{ participant: trackRef.participant, source: Track.Source.Microphone }}
              show="muted"
              className="flex shrink-0 text-destructive [&_svg]:size-3.5"
            />
          )}
          <ParticipantName
            participant={trackRef.participant}
            className="min-w-0 truncate text-sm"
          />
          {trackRef.participant.isLocal ? <span className="shrink-0 text-xs">（我）</span> : null}
        </div>
        <ConnectionQualityIndicator
          participant={trackRef.participant}
          className="flex shrink-0 items-center rounded-md bg-background/90 px-2 py-1 text-muted-foreground data-[lk-quality=excellent]:text-emerald-400 data-[lk-quality=good]:text-amber-400 data-[lk-quality=poor]:text-destructive data-[lk-quality=lost]:text-destructive [&_svg]:size-4"
        />
      </div>
      {onFocusTrack ? (
        <button
          type="button"
          aria-label={`将${trackRef.participant.name || trackRef.participant.identity}的${trackRef.source === Track.Source.ScreenShare ? "共享屏幕" : "摄像头"}设为主画面`}
          title="设为主画面"
          className="absolute inset-0 z-30 cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onClick={() => onFocusTrack(meetingTrackKey(trackRef))}
        />
      ) : null}
      {onResetFocus ? (
        <Button
          className="absolute top-2 right-2 z-30"
          onClick={onResetFocus}
          size="sm"
          variant="secondary"
        >
          自动布局
        </Button>
      ) : null}
      <Badge
        className={cn(
          "pointer-events-none absolute top-2 left-2 z-20 truncate text-[10px] shadow-sm backdrop-blur",
          onResetFocus ? "max-w-[calc(100%-7rem)]" : "max-w-[calc(100%-1rem)]",
        )}
        title={badge.label}
        variant={badge.tone === "candidate" ? "info" : "inverse"}
      >
        {badge.label}
      </Badge>
    </div>
  );
}

const controlButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-sm text-white transition hover:bg-white/15";

const mediaToggleButtonClass = `${controlButtonClass} [&[data-lk-enabled='true']_.toggle-off]:hidden [&[data-lk-enabled='false']_.toggle-on]:hidden`;

const leaveButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-md border border-red-400/40 bg-red-500 px-3 text-sm text-white transition hover:bg-red-500/90";

const endButtonClass =
  "inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/40 bg-amber-500 px-3 text-sm text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60";
