import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@livekit/rtc-node";
import { captureAudio, encodeWav } from "./interview-media-sampling";
const state = vi.hoisted(() => ({
  cancelled: vi.fn(),
  stream: undefined as ReadableStream | undefined,
}));
vi.mock("@livekit/rtc-node", () => ({
  AudioStream: vi.fn(function audioStream() {
    return state.stream;
  }),
  VideoBufferType: { RGBA: 0 },
  VideoStream: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("bounded interval audio sampling", () => {
  it("writes browser-playable mono 16 kHz PCM WAV, retaining signed sample values", () => {
    const bytes = encodeWav(new Int16Array([-32_768, 0, 32_767]));
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.readUInt32LE(24)).toBe(16_000);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt32LE(40)).toBe(6);
    expect(bytes.readInt16LE(44)).toBe(-32_768);
    expect(bytes.readInt16LE(48)).toBe(32_767);
  });
  it("caps a fast source at exactly 15 seconds instead of retaining continuous audio", async () => {
    state.stream = new ReadableStream({
      cancel: state.cancelled,
      pull(c) {
        c.enqueue({ data: new Int16Array(16_000) });
      },
    });
    const result = await captureAudio({} as Track, new AbortController().signal);
    expect(result.durationMs).toBe(15_000);
    expect(result.bytes.length).toBe(480_044);
    expect(state.cancelled).toHaveBeenCalledOnce();
  });
  it("cancels a stalled source at the wall-time limit and reports missing audio", async () => {
    vi.useFakeTimers();
    state.stream = new ReadableStream({ cancel: state.cancelled });
    const promise = captureAudio({} as Track, new AbortController().signal);
    const result = expect(promise).rejects.toThrow("no_audio_frames");
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(state.cancelled).toHaveBeenCalledOnce();
  });
  it("closes streams promptly on worker stop", async () => {
    state.stream = new ReadableStream({ cancel: state.cancelled });
    const controller = new AbortController();
    const promise = captureAudio({} as Track, controller.signal);
    const result = expect(promise).rejects.toThrow("no_audio_frames");
    controller.abort();
    await result;
    expect(state.cancelled).toHaveBeenCalledOnce();
  });
});
