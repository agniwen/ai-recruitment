import { afterEach, describe, expect, it } from "vitest";
import { databaseCodecs } from "../timestamp-codecs";

const originalTimeZone = process.env.TZ;
afterEach(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

describe("database timestamp decoding", () => {
  it.each(["UTC", "Asia/Tokyo", "Asia/Shanghai"])("preserves legacy UTC instants in %s", (zone) => {
    process.env.TZ = zone;
    for (const normalize of [
      databaseCodecs.timestamptz.normalize,
      databaseCodecs.timestamptz.normalizeInJson,
    ]) {
      expect(normalize("2026-09-09 14:06:00.000").toISOString()).toBe("2026-09-09T14:06:00.000Z");
      expect(normalize("2026-09-09 22:06:00+08").toISOString()).toBe("2026-09-09T14:06:00.000Z");
      expect(normalize("2026-09-09T14:06:00.000Z").toISOString()).toBe("2026-09-09T14:06:00.000Z");
    }
  });
});
