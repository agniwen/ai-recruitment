// Rasterize PDF pages to PNG buffers for page-based OCR.
//
// Backed by `mupdf` (WASM): no native build, no canvas/CMap fragility, ships
// its own font + cmap data, runs anywhere Node runs.

import type * as MupdfModuleNs from "mupdf";

type MupdfModule = typeof MupdfModuleNs;

// Stay below qwen-vl-ocr's default 6,422,528-pixel budget before allocating WASM memory.
const MAX_RENDER_DIMENSION = 3200;
const MAX_RENDER_PIXELS = 6_000_000;

let mupdfModulePromise: Promise<MupdfModule> | null = null;

function loadMupdf(): Promise<MupdfModule> {
  mupdfModulePromise ??= import("mupdf");
  return mupdfModulePromise;
}

export interface RasterizeOptions {
  /** Optional preferred scale (72 DPI = 1), capped by the per-page pixel limits. */
  scale?: number;
  maxPages?: number;
}

export interface RasterizeResult {
  /** Rendered pages, in order, capped by `maxPages`. */
  pages: Buffer[];
  /** Total page count of the source PDF (independent of `maxPages`). */
  pageCount: number;
}

export interface ProcessPdfPagesOptions extends RasterizeOptions {
  concurrency?: number;
  onReady?: (meta: { pageCount: number; selectedPages: number }) => void;
}

export interface ProcessPdfPagesResult<T> {
  pageCount: number;
  renderedSizes: number[];
  results: T[];
}

function renderPdfPage(
  mupdf: MupdfModule,
  doc: MupdfModuleNs.Document,
  scale: number | undefined,
  index: number,
): Buffer {
  const page = doc.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const width = x1 - x0;
    const height = y1 - y0;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error(`PDF 第 ${index + 1} 页尺寸无效，无法转换为图片。`);
    }
    // MuPDF rounds bounds outward; reserve two pixels per edge, including shifted pages.
    const renderScale = Math.min(
      scale ?? Number.POSITIVE_INFINITY,
      (MAX_RENDER_DIMENSION - 2) / Math.max(width, height),
      Math.sqrt((MAX_RENDER_PIXELS - 4 * MAX_RENDER_DIMENSION) / (width * height)),
    );
    const matrix = mupdf.Matrix.scale(renderScale, renderScale);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
    try {
      return Buffer.from(pixmap.asPNG());
    } finally {
      pixmap.destroy();
    }
  } finally {
    page.destroy();
  }
}

export async function processPdfPagesWithMeta<T>(
  bytes: Uint8Array,
  { concurrency = 1, maxPages = 6, onReady, scale }: ProcessPdfPagesOptions,
  processPage: (png: Buffer, index: number) => Promise<T>,
): Promise<ProcessPdfPagesResult<T>> {
  const mupdf = await loadMupdf();
  // mupdf takes ownership of the buffer it parses; clone so callers keep
  // their own copy intact.
  const owned = new Uint8Array(bytes);
  const doc = mupdf.Document.openDocument(owned, "application/pdf");

  try {
    const pageCount = doc.countPages();
    const total = Math.min(pageCount, maxPages);
    const renderedSizes = Array.from<number>({ length: total });
    const results = Array.from<T>({ length: total });
    const requestedConcurrency =
      Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1;
    const workerCount = Math.min(total, requestedConcurrency);
    let nextPage = 0;
    let stopped = false;

    onReady?.({ pageCount, selectedPages: total });

    const workers = Array.from({ length: workerCount }, async () => {
      while (!stopped) {
        const index = nextPage;
        if (index >= total) {
          return;
        }
        nextPage += 1;

        try {
          const png = renderPdfPage(mupdf, doc, scale, index);
          renderedSizes[index] = png.byteLength;
          results[index] = await processPage(png, index);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    });
    const settlements = await Promise.allSettled(workers);
    const failed = settlements.find(
      (settlement): settlement is PromiseRejectedResult => settlement.status === "rejected",
    );
    if (failed) {
      throw failed.reason;
    }

    return { pageCount, renderedSizes, results };
  } finally {
    doc.destroy();
  }
}

export async function rasterizePdfWithMeta(
  bytes: Uint8Array,
  { scale, maxPages = 6 }: RasterizeOptions = {},
): Promise<RasterizeResult> {
  const { pageCount, results } = await processPdfPagesWithMeta(
    bytes,
    { concurrency: 1, maxPages, scale },
    (png) => Promise.resolve(png),
  );
  return { pageCount, pages: results };
}

export async function rasterizePdf(
  bytes: Uint8Array,
  options?: RasterizeOptions,
): Promise<Buffer[]> {
  const result = await rasterizePdfWithMeta(bytes, options);
  return result.pages;
}

export interface PdfTextPagesResult {
  pageCount: number;
  pages: string[];
}

export async function extractPdfTextPages(
  bytes: Uint8Array,
  maxPages = 6,
): Promise<PdfTextPagesResult> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const pageCount = doc.countPages();
    const pages: string[] = [];
    for (let index = 0; index < Math.min(pageCount, maxPages); index += 1) {
      const page = doc.loadPage(index);
      try {
        const structuredText = page.toStructuredText();
        try {
          pages.push(structuredText.asText());
        } finally {
          structuredText.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    return { pageCount, pages };
  } finally {
    doc.destroy();
  }
}
