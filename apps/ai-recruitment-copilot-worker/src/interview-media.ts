/* oxlint-disable promise/prefer-await-to-then -- Timer callbacks launch bounded tasks without blocking other participants. */
import { randomUUID } from "node:crypto";
import { Room, RoomEvent, TrackSource } from "@livekit/rtc-node";
import type { RemoteParticipant, RemoteTrackPublication } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import {
  MEDIA_NOTIFY_CHANNEL,
  MEDIA_RECORDER_IDENTITY,
  claimMediaRoom,
  ensureMediaRoom,
  failMediaSample,
  finishMediaSample,
  releaseMediaRoom,
  renewMediaRoom,
  repairInterruptedSamples,
  reserveMediaSample,
} from "@arc/ai-recruitment-copilot-backend/server/routes/platform/routes/interview-logs/routes/media/capture";
import { mediaStorageBackend } from "@arc/ai-recruitment-copilot-backend/server/routes/platform/routes/interview-logs/routes/media/storage";
import {
  AUDIO_INTERVAL_MS,
  IMAGE_INTERVAL_MS,
  captureAudio,
  captureImage,
  waitForTrack,
} from "./interview-media-sampling";

function eligible(participant: RemoteParticipant) {
  return (
    participant.identity.startsWith("candidate_") || participant.identity.startsWith("interviewer_")
  );
}

async function connectSampler(input: {
  roomName: string;
  roomSid: string;
  owner: string;
  url: string;
  apiKey: string;
  apiSecret: string;
}) {
  const room = new Room();
  const abort = new AbortController();
  const running = new Map<string, Promise<void>>();
  const due = new Map<string, number>();
  let renewPending = false;
  let closing: Promise<void> | undefined;
  const timers: {
    tick?: ReturnType<typeof setInterval>;
    heartbeat?: ReturnType<typeof setInterval>;
  } = {};
  const close = (errorCode?: string): Promise<void> => {
    closing ??= (async () => {
      abort.abort();
      clearInterval(timers.tick);
      clearInterval(timers.heartbeat);
      await Promise.allSettled(running.values());
      await room.disconnect();
      await releaseMediaRoom(input.roomSid, input.owner, errorCode);
    })();
    return closing;
  };
  room.on(RoomEvent.Disconnected, () => {
    void close("rtc_disconnected").catch(() => {
      /* Shutdown is already handled; recovery discovery reports any persistent failure. */
    });
  });
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: MEDIA_RECORDER_IDENTITY,
    name: "面试留底采样",
    ttl: "12h",
  });
  token.addGrant({
    canPublish: false,
    canPublishData: false,
    canSubscribe: true,
    hidden: true,
    recorder: true,
    room: input.roomName,
    roomJoin: true,
  });
  try {
    await room.connect(input.url, await token.toJwt(), { autoSubscribe: false, dynacast: true });
    if (abort.signal.aborted || !room.isConnected || (await room.getSid()) !== input.roomSid) {
      throw new Error("room_session_changed");
    }
  } catch (error) {
    await close("rtc_connect_failed");
    throw error;
  }
  async function sample(
    participant: RemoteParticipant,
    kind: "image" | "audio",
    slot: string,
    publication?: RemoteTrackPublication,
  ) {
    if (!participant.sid) {
      return;
    }
    let skipReason: string | undefined;
    if (publication) {
      if (publication.muted) {
        skipReason = "track_muted";
      }
    } else {
      skipReason = kind === "image" ? "camera_off" : "microphone_off";
    }
    const row = await reserveMediaSample({
      kind,
      owner: input.owner,
      participant: {
        identity: participant.identity,
        metadata: participant.metadata,
        name: participant.name || participant.identity,
        sid: participant.sid,
      },
      roomSid: input.roomSid,
      skipReason,
      slot,
      trackSid: publication?.sid,
    });
    if (!row || row.status !== "pending" || !publication) {
      return;
    }
    try {
      publication.setSubscribed(true);
      const track = await waitForTrack(() => publication.track, abort.signal);
      const result = await (kind === "audio"
        ? captureAudio(track, abort.signal)
        : captureImage(track, abort.signal));
      await finishMediaSample(row, input.owner, result);
    } catch (error) {
      const code =
        error instanceof Error &&
        ["no_audio_frames", "no_video_frames", "track_subscription_timeout"].includes(error.message)
          ? error.message
          : "capture_or_storage_failed";
      await failMediaSample(row.id, code);
    } finally {
      publication.setSubscribed(false);
    }
  }
  const tick = () => {
    if (abort.signal.aborted || !room.isConnected) {
      return;
    }
    const participants = [...room.remoteParticipants.values()].filter(eligible);
    if (!participants.length) {
      void close().catch(() => {
        /* Shutdown is already handled; recovery discovery reports any persistent failure. */
      });
      return;
    }
    const keys = new Set<string>();
    for (const participant of participants) {
      if (!participant.sid) {
        continue;
      }
      for (const kind of ["image", "audio"] as const) {
        const key = `${participant.sid}:${kind}`;
        keys.add(key);
        const now = Date.now();
        if (running.has(key) || (due.get(key) ?? 0) > now) {
          continue;
        }
        const interval = kind === "audio" ? AUDIO_INTERVAL_MS : IMAGE_INTERVAL_MS;
        const publication = [...participant.trackPublications.values()].find(
          (p) =>
            p.source ===
            (kind === "audio" ? TrackSource.SOURCE_MICROPHONE : TrackSource.SOURCE_CAMERA),
        );
        due.set(key, now + interval);
        const work = sample(participant, kind, String(Math.floor(now / interval)), publication)
          .catch(() => {
            console.error("[interview-media] sample persistence failed", {
              roomSid: input.roomSid,
            });
          })
          .finally(() => {
            running.delete(key);
          });
        running.set(key, work);
      }
    }
    for (const key of due.keys()) {
      if (!keys.has(key)) {
        due.delete(key);
      }
    }
  };
  timers.heartbeat = setInterval(() => {
    if (renewPending || abort.signal.aborted) {
      return;
    }
    renewPending = true;
    void renewMediaRoom(input.roomSid, input.owner)
      .then((owned) => {
        if (!owned) {
          return close("lease_lost");
        }
      })
      .catch(() => close("lease_renew_failed"))
      .catch(() => {
        /* Shutdown is already handled; recovery discovery reports any persistent failure. */
      })
      .finally(() => {
        renewPending = false;
      });
  }, 10_000);
  timers.tick = setInterval(tick, 1000);
  // Give publications in the initial room snapshot time to arrive.
  return {
    close,
    get closed() {
      return abort.signal.aborted;
    },
  };
}

export async function startInterviewMedia() {
  if (process.env.HUMAN_INTERVIEW_MEDIA_ENABLED !== "true") {
    return async () => {
      /* Shutdown is already handled; recovery discovery reports any persistent failure. */
    };
  }
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error("Interview media requires LiveKit configuration");
  }
  mediaStorageBackend();
  const client = new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret);
  const owner = randomUUID();
  const active = new Map<string, Awaited<ReturnType<typeof connectSampler>>>();
  let stopped = false;
  let pending: Promise<void> | undefined;
  let requested = false;
  const wake = () => {
    if (stopped) {
      return;
    }
    requested = true;
    if (pending) {
      return;
    }
    pending = (async () => {
      try {
        while (requested) {
          if (stopped) {
            break;
          }
          requested = false;
          await repairInterruptedSamples();
          const rooms = await client.listRooms();
          const live = new Set(rooms.map((r) => r.sid));
          for (const [sid, sampler] of active) {
            if (!live.has(sid) || sampler.closed) {
              await sampler.close();
              active.delete(sid);
            }
          }
          for (const room of rooms) {
            if (stopped) {
              break;
            }
            if (!room.name.startsWith("human_") || active.has(room.sid)) {
              continue;
            }
            const participants = await client.listParticipants(room.name);
            if (
              !participants.some(
                (participant) =>
                  participant.identity.startsWith("candidate_") ||
                  participant.identity.startsWith("interviewer_"),
              )
            ) {
              continue;
            }
            const archive = await ensureMediaRoom(room.name, room.sid);
            if (!archive || active.size >= 10 || !(await claimMediaRoom(room.sid, owner))) {
              continue;
            }
            try {
              active.set(
                room.sid,
                await connectSampler({
                  apiKey,
                  apiSecret,
                  owner,
                  roomName: room.name,
                  roomSid: room.sid,
                  url,
                }),
              );
            } catch {
              console.error("[interview-media] room connection failed", { roomSid: room.sid });
            }
          }
        }
      } catch {
        console.error("[interview-media] discovery failed; recovery will retry");
      } finally {
        pending = undefined;
      }
    })();
  };
  const timer = setInterval(wake, 60_000);
  timer.unref();
  let listener: { unlisten: () => Promise<void> } | undefined;
  try {
    listener = await db.$client.listen(MEDIA_NOTIFY_CHANNEL, wake, wake);
  } catch {
    console.error("[interview-media] notifications unavailable; using recovery discovery");
  }
  wake();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await listener?.unlisten();
    await pending;
    await Promise.allSettled([...active.values()].map((sampler) => sampler.close()));
  };
}
