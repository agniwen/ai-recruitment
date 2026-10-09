// @vitest-environment jsdom
import { EventEmitter } from "node:events";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomEvent, ConnectionState } from "livekit-client";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { MeetingTelemetryObserver } from "./meeting-telemetry-observer";

const context = vi.hoisted(() => ({ room: null as unknown }));
vi.mock("@livekit/components-react", () => ({ useRoomContext: () => context.room }));
vi.mock("./telemetry-client", () => ({ readNetwork: () => ({ online: true }) }));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
});
describe("RTC event collection", () => {
  it("refreshes the RTC session ID after reconnect and removes handlers on unmount", async () => {
    // oxlint-disable-next-line unicorn/prefer-event-target -- Match LiveKit Room on/off/emit, which uses EventEmitter.
    const room = Object.assign(new EventEmitter(), {
      getSid: () => Promise.resolve("RM_1"),
      localParticipant: { sid: "PA_1", trackPublications: new Map() },
      remoteParticipants: new Map(),
      state: ConnectionState.Connected,
    });
    context.room = room;
    const telemetry = {
      emit: vi.fn(),
      flush: vi.fn(),
      headers: vi.fn(),
      setRoom: vi.fn(),
      startAttempt: vi.fn(),
    };
    rendered = await renderInAct(<MeetingTelemetryObserver telemetry={telemetry} />);
    expect(telemetry.setRoom).toHaveBeenCalledWith({ participantSid: "PA_1", roomSid: "RM_1" });
    await act(async () => {
      room.emit(RoomEvent.Reconnecting);
      room.localParticipant.sid = "PA_2";
      room.emit(RoomEvent.Reconnected);
      await Promise.resolve();
    });
    expect(telemetry.emit).toHaveBeenCalledWith("reconnecting");
    expect(telemetry.emit).toHaveBeenCalledWith("reconnected", expect.any(Object));
    expect(telemetry.setRoom).toHaveBeenLastCalledWith({ participantSid: "PA_2", roomSid: "RM_1" });
    await unmountInAct(rendered.root);
    rendered = undefined;
    expect(room.listenerCount(RoomEvent.Reconnected)).toBe(0);
    expect(telemetry.emit).toHaveBeenCalledWith("component_unmounted", {
      reason: "livekit_room_unmounted",
      state: ConnectionState.Connected,
    });
  });

  it("records the affected device kind with permission failures", async () => {
    // oxlint-disable-next-line unicorn/prefer-event-target -- Match LiveKit Room on/off/emit.
    const room = Object.assign(new EventEmitter(), {
      localParticipant: { trackPublications: new Map() },
      state: ConnectionState.Disconnected,
    });
    context.room = room;
    const telemetry = {
      emit: vi.fn(),
      flush: vi.fn(),
      headers: vi.fn(),
      setRoom: vi.fn(),
      startAttempt: vi.fn(),
    };
    rendered = await renderInAct(<MeetingTelemetryObserver telemetry={telemetry} />);
    room.emit(
      RoomEvent.MediaDevicesError,
      new DOMException("blocked", "NotAllowedError"),
      "audioinput",
    );
    expect(telemetry.emit).toHaveBeenCalledWith("media_device_error", {
      deviceKind: "audioinput",
      errorName: "NotAllowedError",
    });
  });
});
