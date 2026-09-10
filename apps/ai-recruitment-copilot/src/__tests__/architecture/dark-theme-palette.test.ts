import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const GLOBAL_STYLES_PATH = path.join(
  repoRoot,
  "apps/ai-recruitment-copilot/src/styles/globals.css",
);

function relativeLuminance(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function parseOklch(value: string) {
  const parsed = value.match(
    /oklch\((?<lightness>[\d.]+)\s+(?<chroma>[\d.]+)\s+(?<hue>[\d.]+)/,
  )?.groups;
  if (!parsed) {
    throw new Error(`expected an oklch() token, received ${value}`);
  }

  return {
    chroma: Number(parsed.chroma),
    hue: Number(parsed.hue),
    lightness: Number(parsed.lightness),
  };
}

function oklchToHex(value: string) {
  const { lightness, chroma, hue: hueDegrees } = parseOklch(value);
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const linearChannels = [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ];

  return `#${linearChannels
    .map((channel) => {
      const encoded =
        channel <= 0.003_130_8 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function themeTokens(selector: RegExp) {
  const globalStyles = readFileSync(GLOBAL_STYLES_PATH, "utf-8");
  const tokens = globalStyles.match(selector)?.groups?.tokens;
  if (!tokens) {
    throw new Error(`missing ${selector.source} block in globals.css`);
  }

  return tokens;
}

function tokenValue(tokens: string, name: string) {
  const declaration = tokens
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${name}:`));
  if (!declaration) {
    throw new Error(`missing ${name} in globals.css`);
  }

  return declaration
    .slice(name.length + 1)
    .replace(/;$/, "")
    .trim();
}

function compositeHex(foreground: string, background: string, alpha: number) {
  const channels = [1, 3, 5].map((offset) => {
    const foregroundChannel = Number.parseInt(foreground.slice(offset, offset + 2), 16);
    const backgroundChannel = Number.parseInt(background.slice(offset, offset + 2), 16);
    return Math.round(foregroundChannel * alpha + backgroundChannel * (1 - alpha));
  });

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("dark theme palette", () => {
  it("keeps the dark brand hue in the light-mode blue family", () => {
    const lightHue = parseOklch(
      tokenValue(themeTokens(/^:root \{(?<tokens>[\s\S]*?)\n\}/m), "--primary"),
    ).hue;
    const darkTokens = themeTokens(/^\.dark \{(?<tokens>[\s\S]*?)\n\}/m);
    const brandTokens = [
      "--primary",
      "--primary-foreground",
      "--ring",
      "--sidebar-primary",
      "--sidebar-ring",
      "--chart-1",
      "--chart-2",
      "--chart-3",
      "--chart-4",
      "--chart-5",
    ];

    for (const brandToken of brandTokens) {
      const value = tokenValue(darkTokens, brandToken);
      expect(parseOklch(value).hue, `${brandToken} should share the light-mode hue`).toBe(lightHue);
    }
  });

  it("keeps dark-mode branded controls legible", () => {
    const darkTokens = themeTokens(/^\.dark \{(?<tokens>[\s\S]*?)\n\}/m);
    const primary = oklchToHex(tokenValue(darkTokens, "--primary"));
    const primaryForeground = oklchToHex(tokenValue(darkTokens, "--primary-foreground"));

    expect(contrastRatio(primaryForeground, primary)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(primary, compositeHex(primaryForeground, primary, 0.8)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps job description charts separated by theme-aware tracks and boundaries", () => {
    const chartSource = readFileSync(
      path.join(
        repoRoot,
        "apps/ai-recruitment-copilot/src/components/features/studio/job-descriptions/job-description-charts.tsx",
      ),
      "utf-8",
    );

    expect(chartSource).toContain('const CANDIDATE_BLUE = "var(--chart-1)"');
    expect(chartSource).toContain(
      'const COMPLETION_TRACK = "color-mix(in oklab, var(--muted-foreground) 16%, transparent)"',
    );
    expect(chartSource).toContain(
      'const STEM_MUTED = "color-mix(in oklab, var(--muted-foreground) 45%, transparent)"',
    );
    expect(chartSource).toContain('ruleY([0], { stroke: "var(--border)", strokeWidth: 1 })');
    expect(chartSource).toContain('ruleX([0], { stroke: "var(--border)", strokeWidth: 1 })');
  });

  it("derives touch and selection feedback from the active theme", () => {
    const globalStyles = readFileSync(GLOBAL_STYLES_PATH, "utf-8");

    expect(globalStyles).toContain(
      ".dark body {\n    -webkit-tap-highlight-color: color-mix(in oklab, var(--primary) 14%, transparent)",
    );
    expect(globalStyles).toContain("-webkit-tap-highlight-color: rgba(61, 142, 238, 0.14)");
    expect(globalStyles).toContain(".dark ::selection");
  });
});
