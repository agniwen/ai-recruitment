import { MEDIA_RECORDER_IDENTITY } from "../platform/routes/interview-logs/routes/media/capture";
import { DisconnectReason } from "@livekit/protocol";
import type { WebhookEvent } from "livekit-server-sdk";
import { interviewTraceSchema } from "@arc/shared/interview-telemetry";
import { recordServerTelemetry } from "../public/routes/interview-telemetry/dao";

export function webhookTelemetry(event: WebhookEvent) {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(event.participant?.metadata || "{}");
  } catch {
    /* Foreign clients may omit metadata. */
  }
  const trace = interviewTraceSchema.safeParse(metadata?.interview_trace);
  return {
    details:
      event.participant &&
      ["participant_left", "participant_connection_aborted"].includes(event.event)
        ? { reason: DisconnectReason[event.participant.disconnectReason] ?? "UNKNOWN_REASON" }
        : {},
    eventKey: event.id,
    occurredAt: new Date(Number(event.createdAt) * 1000),
    participantIdentity: event.participant?.identity,
    participantName: event.participant?.name,
    participantRole:
      typeof metadata?.participant_role === "string"
        ? metadata.participant_role.slice(0, 40)
        : undefined,
    participantSid: event.participant?.sid,
    roomName: event.room?.name ?? null,
    roomSid: event.room?.sid,
    source: "livekit" as const,
    trace: trace.success ? trace.data : {},
    type: event.event,
  };
}

export async function saveLiveKitTelemetry(event: WebhookEvent) {
  if (
    !event.room?.name?.startsWith("human_") ||
    !event.id ||
    event.participant?.identity === MEDIA_RECORDER_IDENTITY
  ) {
    return;
  }
  // Await durable storage; a failed write must make the webhook retry, not acknowledge lost evidence.
  await recordServerTelemetry(webhookTelemetry(event));
}
