import { describe, expect, it } from "vitest";
import { isLegacyParseEnabled } from "./config";

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
});
