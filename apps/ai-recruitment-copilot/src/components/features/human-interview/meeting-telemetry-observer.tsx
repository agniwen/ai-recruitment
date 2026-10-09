import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, ConnectionState, version } from "livekit-client";
import type { Participant, TrackPublication, ConnectionQuality } from "livekit-client";
import type { InterviewEventDetails } from "@arc/shared/interview-telemetry";
import type { useMeetingTelemetry } from "./use-meeting-telemetry";
import { summarizeRtcStats } from "./rtc-stats";
import { readNetwork } from "./telemetry-client";

export function MeetingTelemetryObserver({
  telemetry,
}: {
  telemetry: ReturnType<typeof useMeetingTelemetry>;
}) {
  const room = useRoomContext();
  const { emit, setRoom, flush } = telemetry;
  useEffect(() => {
    let active = true;
    let sampling = false;
    let previous: { time: number; sample: InterviewEventDetails } | undefined;
    const captureConnection = async (type: "connected" | "reconnected") => {
      setRoom({ participantSid: room.localParticipant.sid });
      try {
        const roomSid = await room.getSid();
        if (!active) {
          return;
        }
        setRoom({ participantSid: room.localParticipant.sid, roomSid });
      } catch {
        // Connection evidence is still useful when the SDK cannot resolve the room SID.
      }
      if (active) {
        emit(type, { sdkVersion: version });
        flush();
      }
    };
    const connected = () => {
      void captureConnection("connected");
    };
    const state = (value: ConnectionState) => emit("connection_state_changed", { state: value });
    const reconnecting = () => {
      emit("reconnecting");
      flush();
    };
    const reconnected = () => {
      previous = undefined;
      void captureConnection("reconnected");
    };
    const quality = (value: ConnectionQuality, participant: Participant) => {
      if (participant.isLocal) {
        emit("connection_quality_changed", { quality: value });
      }
    };
    const deviceError = (error: Error, kind?: MediaDeviceKind) =>
      emit("media_device_error", { deviceKind: kind, errorName: error.name });
    const device = (kind: MediaDeviceKind) => emit("media_device_changed", { deviceKind: kind });
    const muted = (track: TrackPublication, participant: Participant) => {
      if (participant.isLocal) {
        emit("track_muted", { trackSource: track.source });
      }
    };
    const unmuted = (track: TrackPublication, participant: Participant) => {
      if (participant.isLocal) {
        emit("track_unmuted", { trackSource: track.source });
      }
    };
    const published = (track: TrackPublication) =>
      emit("track_published", { trackSource: track.source });
    const unpublished = (track: TrackPublication) =>
      emit("track_unpublished", { trackSource: track.source });
    async function sample() {
      if (sampling || room.state !== ConnectionState.Connected) {
        return;
      }
      sampling = true;
      try {
        const participants = [room.localParticipant, ...room.remoteParticipants.values()];
        const tracks = participants
          .flatMap((p) => [...p.trackPublications.values()])
          .flatMap((p) => (p.track ? [p.track] : []))
          .slice(0, 12);
        const reports = await Promise.all(
          tracks.map(async (track) => {
            try {
              return await track.getRTCStatsReport();
            } catch {
              // Some browsers or ended tracks do not expose a stats report.
            }
          }),
        );
        if (!active) {
          return;
        }
        const summary = summarizeRtcStats(reports.flatMap((r) => (r ? [r] : [])));
        const time = performance.now();
        if (previous && time > previous.time) {
          const seconds = (time - previous.time) / 1000;
          if (summary.bytesSent !== undefined && previous.sample.bytesSent !== undefined) {
            summary.sendBitrate =
              (Math.max(0, summary.bytesSent - previous.sample.bytesSent) * 8) / seconds;
          }
          if (summary.bytesReceived !== undefined && previous.sample.bytesReceived !== undefined) {
            summary.receiveBitrate =
              (Math.max(0, summary.bytesReceived - previous.sample.bytesReceived) * 8) / seconds;
          }
        }
        previous = { sample: summary, time };
        emit("network_sample", {
          ...readNetwork(),
          ...summary,
          quality: room.localParticipant.connectionQuality,
        });
      } catch {
        if (active) {
          emit("network_sample", { ...readNetwork(), sampleAvailable: false });
        }
      } finally {
        sampling = false;
      }
    }
    room
      .on(RoomEvent.Connected, connected)
      .on(RoomEvent.ConnectionStateChanged, state)
      .on(RoomEvent.Reconnecting, reconnecting)
      .on(RoomEvent.Reconnected, reconnected)
      .on(RoomEvent.ConnectionQualityChanged, quality)
      .on(RoomEvent.MediaDevicesError, deviceError)
      .on(RoomEvent.ActiveDeviceChanged, device)
      .on(RoomEvent.LocalTrackPublished, published)
      .on(RoomEvent.LocalTrackUnpublished, unpublished)
      .on(RoomEvent.TrackMuted, muted)
      .on(RoomEvent.TrackUnmuted, unmuted);
    if (room.state === ConnectionState.Connected) {
      connected();
    }
    const interval = window.setInterval(() => {
      void sample();
    }, 15_000);
    return () => {
      active = false;
      clearInterval(interval);
      emit("component_unmounted", { reason: "livekit_room_unmounted", state: room.state });
      flush();
      room
        .off(RoomEvent.Connected, connected)
        .off(RoomEvent.ConnectionStateChanged, state)
        .off(RoomEvent.Reconnecting, reconnecting)
        .off(RoomEvent.Reconnected, reconnected)
        .off(RoomEvent.ConnectionQualityChanged, quality)
        .off(RoomEvent.MediaDevicesError, deviceError)
        .off(RoomEvent.ActiveDeviceChanged, device)
        .off(RoomEvent.LocalTrackPublished, published)
        .off(RoomEvent.LocalTrackUnpublished, unpublished)
        .off(RoomEvent.TrackMuted, muted)
        .off(RoomEvent.TrackUnmuted, unmuted);
    };
  }, [room, emit, setRoom, flush]);
  return null;
}
