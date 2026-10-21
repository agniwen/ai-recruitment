import { setTimeout as delay } from "node:timers/promises";
import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { extractPdfTextPages, processPdfPagesWithMeta } from "../pdf-rasterize";

function createPdf(pageCount: number, bounds: mupdf.Rect = [0, 0, 100, 100]): Buffer {
  const document = new mupdf.PDFDocument();
  try {
    for (let index = 0; index < pageCount; index += 1) {
      const page = document.addPage(bounds, 0, {}, Buffer.from("q\nQ\n"));
      document.insertPage(-1, page);
    }
    const saved = document.saveToBuffer();
    try {
      return Buffer.from(saved.asUint8Array());
    } finally {
      saved.destroy();
    }
  } finally {
    document.destroy();
  }
}

describe("processPdfPagesWithMeta", () => {
  it.each<{ name: string; bounds: mupdf.Rect }>([
    { bounds: [0, 0, 595, 842], name: "A4" },
    { bounds: [0, 0, 8000, 4500], name: "oversized landscape resume" },
    { bounds: [0, 0, 8000, 8000], name: "oversized square" },
    { bounds: [0, 0, 100, 8000], name: "long narrow page" },
    { bounds: [-4000.5, 200.25, 3999.5, 8200.25], name: "shifted fractional page" },
  ])("renders $name inside both pixel limits while preserving aspect ratio", async ({ bounds }) => {
    const result = await processPdfPagesWithMeta(createPdf(1, bounds), {}, (png) =>
      Promise.resolve({
        height: png.readUInt32BE(20),
        width: png.readUInt32BE(16),
      }),
    );
    const [{ width, height }] = result.results;
    expect(Math.max(width, height)).toBeLessThanOrEqual(3200);
    expect(width * height).toBeLessThanOrEqual(6_000_000);
    expect(width / height).toBeCloseTo((bounds[2] - bounds[0]) / (bounds[3] - bounds[1]), 2);
    // Normal-sized text pages should still be rendered at OCR-quality resolution.
    expect(Math.max(width, height)).toBeGreaterThanOrEqual(2400);
  });

  it("processes pages through a bounded pool and preserves page order", async () => {
    const pdf = createPdf(6);
    const originalPdf = Buffer.from(pdf);
    let active = 0;
    let maxActive = 0;

    const result = await processPdfPagesWithMeta(
      pdf,
      { concurrency: 4, maxPages: 6, scale: 1 },
      async (png, index) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay((6 - index) * 2);
        active -= 1;
        expect(png.byteLength).toBeGreaterThan(0);
        return `page-${index + 1}`;
      },
    );

    expect(maxActive).toBe(4);
    expect(pdf).toEqual(originalPdf);
    expect(result.pageCount).toBe(6);
    expect(result.renderedSizes).toHaveLength(6);
    expect(result.results).toEqual(["page-1", "page-2", "page-3", "page-4", "page-5", "page-6"]);
  });
});

it("extracts real PDF text in page order and respects the page limit", async () => {
  const document = new mupdf.PDFDocument();
  const font = new mupdf.Font("Helvetica");
  let bytes: Buffer;
  try {
    const fontObject = document.addSimpleFont(font);
    for (const text of ["Candidate 2022-01", "Project 2024-08", "Not selected"]) {
      const page = document.addPage(
        [0, 0, 320, 200],
        0,
        { Font: { F1: fontObject } },
        `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`,
      );
      document.insertPage(-1, page);
    }
    const buffer = document.saveToBuffer();
    try {
      bytes = Buffer.from(buffer.asUint8Array());
    } finally {
      buffer.destroy();
    }
  } finally {
    font.destroy();
    document.destroy();
  }
  const result = await extractPdfTextPages(bytes, 2);
  expect(result.pageCount).toBe(3);
  expect(result.pages).toHaveLength(2);
  expect(result.pages[0]).toContain("Candidate 2022-01");
  expect(result.pages[1]).toContain("Project 2024-08");
});
