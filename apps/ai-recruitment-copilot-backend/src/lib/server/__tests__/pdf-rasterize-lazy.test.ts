import { beforeEach, describe, expect, it, vi } from "vitest";

const mupdfMocks = vi.hoisted(() => ({
  documentDestroy: vi.fn(),
  failRenderAt: new Set<number>(),
  loadPage: vi.fn(),
  pageBounds: [[0, 0, 100, 100]],
  pageDestroy: vi.fn(),
  pixmapDestroy: vi.fn(),
  scale: vi.fn((x: number, y: number) => [x, 0, 0, y, 0, 0]),
}));

vi.mock("mupdf", () => ({
  ColorSpace: { DeviceRGB: Symbol("DeviceRGB") },
  Document: {
    openDocument: () => ({
      countPages: () => 6,
      destroy: mupdfMocks.documentDestroy,
      loadPage: (index: number) => {
        mupdfMocks.loadPage(index);
        return {
          destroy: mupdfMocks.pageDestroy,
          getBounds: () => mupdfMocks.pageBounds[index % mupdfMocks.pageBounds.length],
          toPixmap: () => {
            if (mupdfMocks.failRenderAt.has(index)) {
              throw new Error(`render failed at page ${index + 1}`);
            }
            return {
              asPNG: () => new Uint8Array([index + 1]),
              destroy: mupdfMocks.pixmapDestroy,
            };
          },
        };
      },
    }),
  },
  Matrix: { scale: mupdfMocks.scale },
}));

const { processPdfPagesWithMeta } = await import("../pdf-rasterize");

describe("lazy PDF page rasterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mupdfMocks.failRenderAt.clear();
    mupdfMocks.pageBounds = [[0, 0, 100, 100]];
  });

  it("does not render pages beyond the active processing window", async () => {
    const { promise: pageGate, resolve: releasePages } = Promise.withResolvers<boolean>();
    const started: number[] = [];

    const processing = processPdfPagesWithMeta(
      new Uint8Array([1, 2, 3]),
      { concurrency: 4, maxPages: 6, scale: 2 },
      async (_png, index) => {
        started.push(index);
        await pageGate;
        return `page-${index + 1}`;
      },
    );

    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(mupdfMocks.loadPage).toHaveBeenCalledTimes(4);

    releasePages(true);
    await expect(processing).resolves.toMatchObject({
      results: ["page-1", "page-2", "page-3", "page-4", "page-5", "page-6"],
    });
    expect(mupdfMocks.loadPage).toHaveBeenCalledTimes(6);
  });

  it("stops assigning pages when rendering fails", async () => {
    mupdfMocks.failRenderAt.add(0);

    await expect(
      processPdfPagesWithMeta(
        new Uint8Array([1, 2, 3]),
        { concurrency: 4, maxPages: 6, scale: 2 },
        () => Promise.resolve("unreachable"),
      ),
    ).rejects.toThrow("render failed at page 1");

    expect(mupdfMocks.loadPage).toHaveBeenCalledTimes(1);
    expect(mupdfMocks.documentDestroy).toHaveBeenCalledTimes(1);
  });

  it("fits each page inside the pixel limits before rendering, even with an explicit scale", async () => {
    mupdfMocks.pageBounds = [
      [0, 0, 595, 842],
      [0, 0, 8000, 4500],
      [-4000.5, 200.25, 3999.5, 8200.25],
    ];

    await processPdfPagesWithMeta(new Uint8Array([1, 2, 3]), { maxPages: 3, scale: 4 }, () =>
      Promise.resolve("ok"),
    );

    expect(mupdfMocks.scale).toHaveBeenCalledTimes(3);
    for (const [index, [scale]] of mupdfMocks.scale.mock.calls.entries()) {
      const [x0, y0, x1, y1] = mupdfMocks.pageBounds[index];
      const width = Math.ceil(x1 * scale) - Math.floor(x0 * scale);
      const height = Math.ceil(y1 * scale) - Math.floor(y0 * scale);
      expect(Math.max(width, height)).toBeLessThanOrEqual(3200);
      expect(width * height).toBeLessThanOrEqual(6_000_000);
    }
    expect(mupdfMocks.scale.mock.calls[1][0]).toBeLessThan(1);
  });

  it("rejects invalid page dimensions and releases the document", async () => {
    mupdfMocks.pageBounds = [[0, 0, 0, 100]];

    await expect(
      processPdfPagesWithMeta(new Uint8Array([1]), {}, () => Promise.resolve("unreachable")),
    ).rejects.toThrow("PDF 第 1 页尺寸无效");

    expect(mupdfMocks.pixmapDestroy).not.toHaveBeenCalled();
    expect(mupdfMocks.pageDestroy).toHaveBeenCalledTimes(1);
    expect(mupdfMocks.documentDestroy).toHaveBeenCalledTimes(1);
  });
});
