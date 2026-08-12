import { describe, expect, it } from "vitest";
import { isLegacyParseEnabled, resolveLegacyParseConfig } from "./config";

describe("isLegacyParseEnabled", () => {
  it("is disabled by default", () => {
    expect(isLegacyParseEnabled({})).toBe(false);
  });

  it("only enables legacy parsing for true", () => {
    expect(isLegacyParseEnabled({ ENABLE_LEGACY_PARSE: "true" })).toBe(true);
    expect(isLegacyParseEnabled({ ENABLE_LEGACY_PARSE: " TRUE " })).toBe(true);
    expect(isLegacyParseEnabled({ ENABLE_LEGACY_PARSE: "false" })).toBe(false);
    expect(isLegacyParseEnabled({ ENABLE_LEGACY_PARSE: "1" })).toBe(false);
    expect(isLegacyParseEnabled({ ENABLE_LEGACY_PARSE: "ture" })).toBe(false);
  });

  it("requires the target workspace and uploader when enabled", () => {
    expect(() => resolveLegacyParseConfig({ ENABLE_LEGACY_PARSE: "true" })).toThrow(
      "LEGACY_PARSE_WORKSPACE_SLUG",
    );
    expect(() =>
      resolveLegacyParseConfig({
        ENABLE_LEGACY_PARSE: "true",
        LEGACY_PARSE_WORKSPACE_SLUG: "workspace",
      }),
    ).toThrow("LEGACY_PARSE_UPLOADER_EMAIL");
  });

  it("returns the automatic import identity when enabled", () => {
    expect(
      resolveLegacyParseConfig({
        ENABLE_LEGACY_PARSE: "true",
        LEGACY_PARSE_UPLOADER_EMAIL: " admin@example.com ",
        LEGACY_PARSE_WORKSPACE_SLUG: " workspace ",
      }),
    ).toEqual({
      queueHighWatermark: 500,
      queueLowWatermark: 200,
      uploaderEmail: "admin@example.com",
      workspaceSlug: "workspace",
    });
  });

  it("validates custom queue watermarks", () => {
    expect(() =>
      resolveLegacyParseConfig({
        ENABLE_LEGACY_PARSE: "true",
        LEGACY_PARSE_QUEUE_HIGH_WATERMARK: "100",
        LEGACY_PARSE_QUEUE_LOW_WATERMARK: "100",
        LEGACY_PARSE_UPLOADER_EMAIL: "admin@example.com",
        LEGACY_PARSE_WORKSPACE_SLUG: "workspace",
      }),
    ).toThrow("LOW_WATERMARK");
    expect(
      resolveLegacyParseConfig({
        ENABLE_LEGACY_PARSE: "true",
        LEGACY_PARSE_QUEUE_HIGH_WATERMARK: "800",
        LEGACY_PARSE_QUEUE_LOW_WATERMARK: "300",
        LEGACY_PARSE_UPLOADER_EMAIL: "admin@example.com",
        LEGACY_PARSE_WORKSPACE_SLUG: "workspace",
      }),
    ).toMatchObject({ queueHighWatermark: 800, queueLowWatermark: 300 });
  });
});
