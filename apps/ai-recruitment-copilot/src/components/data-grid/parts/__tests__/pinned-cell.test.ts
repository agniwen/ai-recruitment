import { describe, expect, it } from "vitest";
import {
  getPinnedEdgeClassName,
  getPinningStyles,
  PINNED_EDGE_LEFT_BORDER_CLASS,
  PINNED_EDGE_RIGHT_BORDER_CLASS,
  PINNED_HEADER_CLASS,
  readHorizontalScrollOverflow,
  STICKY_HEADER_CLASS,
} from "../pinned-cell";

describe("pinned table headers", () => {
  it("uses the opaque equivalent of the CardFrame header surface", () => {
    const opaqueHeaderSurface = "bg-[color-mix(in_srgb,var(--card)_28%,var(--muted)_72%)]";

    expect(PINNED_HEADER_CLASS).toContain(opaqueHeaderSurface);
    expect(STICKY_HEADER_CLASS).toContain(opaqueHeaderSurface);
    expect(PINNED_HEADER_CLASS).not.toMatch(/\/(?:\d+)/);
  });
});

describe("pinned edge separators", () => {
  it("uses a single absolute 1px divider without a shadow", () => {
    expect(PINNED_EDGE_LEFT_BORDER_CLASS).toContain("before:w-px");
    expect(PINNED_EDGE_LEFT_BORDER_CLASS).toContain("before:bg-border");
    expect(PINNED_EDGE_RIGHT_BORDER_CLASS).toContain("before:w-px");
    expect(PINNED_EDGE_RIGHT_BORDER_CLASS).toContain("before:bg-border");
    expect(PINNED_EDGE_LEFT_BORDER_CLASS).not.toMatch(/shadow/);
    expect(PINNED_EDGE_RIGHT_BORDER_CLASS).not.toMatch(/shadow/);
  });

  it("only paints the pin-edge divider while scroll has content under that side", () => {
    expect(
      getPinnedEdgeClassName({
        isLeftEdge: true,
        isRightEdge: false,
        showLeftEdge: false,
      }),
    ).toBe("");

    expect(
      getPinnedEdgeClassName({
        isLeftEdge: true,
        isRightEdge: false,
        showLeftEdge: true,
      }),
    ).toBe(PINNED_EDGE_LEFT_BORDER_CLASS);

    expect(
      getPinnedEdgeClassName({
        isLeftEdge: false,
        isRightEdge: true,
        showRightEdge: false,
      }),
    ).toBe("");

    expect(
      getPinnedEdgeClassName({
        isLeftEdge: false,
        isRightEdge: true,
        showRightEdge: true,
      }),
    ).toBe(PINNED_EDGE_RIGHT_BORDER_CLASS);
  });

  it("reads horizontal scroll overflow with a sub-pixel tolerance", () => {
    expect(
      readHorizontalScrollOverflow({
        clientWidth: 200,
        scrollLeft: 0,
        scrollWidth: 200,
      } as HTMLElement),
    ).toEqual({ canScrollLeft: false, canScrollRight: false });

    expect(
      readHorizontalScrollOverflow({
        clientWidth: 200,
        scrollLeft: 40,
        scrollWidth: 500,
      } as HTMLElement),
    ).toEqual({ canScrollLeft: true, canScrollRight: true });

    expect(
      readHorizontalScrollOverflow({
        clientWidth: 200,
        scrollLeft: 300,
        scrollWidth: 500,
      } as HTMLElement),
    ).toEqual({ canScrollLeft: true, canScrollRight: false });
  });
});

describe("fixed-width columns", () => {
  it("applies an explicit width without making an unpinned column sticky", () => {
    const column = {
      columnDef: { maxSize: 80, minSize: 80 },
      getAfter: () => 0,
      getIsPinned: () => false,
      getSize: () => 80,
      getStart: () => 0,
    } as unknown as Parameters<typeof getPinningStyles>[0];

    const styles = getPinningStyles(column);

    expect(styles).toMatchObject({
      maxWidth: "80px",
      minWidth: "80px",
      width: "80px",
    });
    expect(styles.position).toBeUndefined();
  });
});
