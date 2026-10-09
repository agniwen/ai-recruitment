import { setTimeout as delay } from "node:timers/promises";
import { AudioStream, VideoStream, VideoBufferType } from "@livekit/rtc-node";
import type { Track } from "@livekit/rtc-node";
import sharp from "sharp";

export const AUDIO_SAMPLE_MS = 15_000;
export const AUDIO_INTERVAL_MS = 120_000;
export const IMAGE_INTERVAL_MS = 30_000;
const SAMPLE_RATE = 16_000;

export function encodeWav(samples: Int16Array) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    bytes.writeInt16LE(samples[i], 44 + i * 2);
  }
  return bytes;
}

// Both wall time and sample count are bounded. No frames are buffered between windows.
export async function captureAudio(track: Track, signal: AbortSignal) {
  const reader = new AudioStream(track, {
    frameSizeMs: 20,
    numChannels: 1,
    sampleRate: SAMPLE_RATE,
  }).getReader();
  const samples = new Int16Array((SAMPLE_RATE * AUDIO_SAMPLE_MS) / 1000);
  let length = 0;
  const stop = async () => {
    try {
      await reader.cancel();
    } catch {
      // The track may have already closed.
    }
  };
  const timer = setTimeout(stop, AUDIO_SAMPLE_MS);
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    while (length < samples.length) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const count = Math.min(value.data.length, samples.length - length);
      samples.set(value.data.subarray(0, count), length);
      length += count;
    }
    if (length < SAMPLE_RATE / 2) {
      throw new Error("no_audio_frames");
    }
    return {
      bytes: encodeWav(samples.subarray(0, length)),
      contentType: "audio/wav",
      durationMs: Math.round((length / SAMPLE_RATE) * 1000),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function captureImage(track: Track, signal: AbortSignal) {
  const reader = new VideoStream(track).getReader();
  const stop = async () => {
    try {
      await reader.cancel();
    } catch {
      // The track may have already closed.
    }
  };
  const timer = setTimeout(stop, 5000);
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const { done, value } = await reader.read();
    if (done || !value) {
      throw new Error("no_video_frames");
    }
    const frame = value.frame.convert(VideoBufferType.RGBA);
    // Release the stream before encoding; VideoStream does not apply upstream backpressure.
    await reader.cancel();
    const bytes = await sharp(frame.data, {
      raw: { channels: 4, height: frame.height, width: frame.width },
    })
      .rotate([0, 90, 180, 270][value.rotation] ?? 0)
      .resize({ fit: "inside", height: 960, width: 960, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    return { bytes, contentType: "image/jpeg" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function waitForTrack(getTrack: () => Track | undefined, signal: AbortSignal) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    signal.throwIfAborted();
    const track = getTrack();
    if (track) {
      return track;
    }
    await delay(50, undefined, { signal });
  }
  throw new Error("track_subscription_timeout");
}
