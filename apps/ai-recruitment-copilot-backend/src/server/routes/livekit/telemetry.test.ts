import { describe, expect, it, vi } from "vitest";
import { ParticipantInfo } from "@livekit/protocol";
import { WebhookEvent } from "livekit-server-sdk";
import { webhookTelemetry } from "./telemetry";
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({ db: {} }));

describe("LiveKit telemetry mapping", () => {
  it("preserves authoritative disconnect reason and signed trace, excludes metadata secrets", () => {
    const trace = {
      attemptId: "00000000-0000-4000-8000-000000000003",
      browserId: "00000000-0000-4000-8000-000000000004",
      fingerprintId: "a".repeat(32),
      fingerprintVersion: "fingerprintjs-test",
      tabId: "00000000-0000-4000-8000-000000000002",
      visitId: "00000000-0000-4000-8000-000000000001",
    };
    const result = webhookTelemetry(
      WebhookEvent.fromJson({
        createdAt: "1791421200",
        event: "participant_left",
        id: "EV_1",
        participant: {
          disconnectReason: "DUPLICATE_IDENTITY",
          identity: "candidate_round",
          metadata: JSON.stringify({ interview_trace: trace, token: "private" }),
          sid: "PA_1",
        },
        room: { name: "human_room", sid: "RM_1" },
      }),
    );
    expect(result).toMatchObject({
      details: { reason: "DUPLICATE_IDENTITY" },
      eventKey: "EV_1",
      participantSid: "PA_1",
      source: "livekit",
      trace,
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("accepts foreign or invalid metadata without losing the event", () => {
    expect(
      webhookTelemetry(
        new WebhookEvent({ participant: new ParticipantInfo({ metadata: "broken" }) }),
      ).trace,
    ).toEqual({});
  });
});
