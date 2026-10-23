// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeLibraryCardList } from "../resume-library-page-list";

const fixture = vi.hoisted(() => ({ viewport: null as HTMLElement | null }));

vi.mock("../resume-library-page-model", () => ({
  formatResumeLibraryJobDescriptionLabel: vi.fn(),
  useResumeLibraryCardHeight: () => 272,
  useResumeLibraryScrollElement: () => fixture.viewport,
}));
vi.mock("@/components/data-grid/parts/toolbar", () => ({ Toolbar: () => null }));
vi.mock("../resume-library-card", () => ({ ResumeLibraryCard: () => <article /> }));

type Props = ComponentProps<typeof ResumeLibraryCardList>;

const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
  nodes = new Set<Element>();
  callback: ResizeObserverCallback;

  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- ResizeObserver requires a callback.
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.add(this);
  }

  observe(node: Element) {
    this.nodes.add(node);
  }

  unobserve(node: Element) {
    this.nodes.delete(node);
  }

  disconnect() {
    this.nodes.clear();
    observers.delete(this);
  }

  resize(node: HTMLElement, height: number) {
    if (this.nodes.has(node)) {
      this.callback(
        [
          { borderBoxSize: [{ blockSize: height, inlineSize: 1660 }], target: node },
        ] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver,
      );
    }
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1660);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function getHeight(this: HTMLElement) {
      return this.dataset.resumeRecordId === "protected" ? 360 : 272;
    },
  );
  fixture.viewport = document.createElement("div");
  document.body.append(fixture.viewport);
});

afterEach(() => {
  observers.clear();
  fixture.viewport = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("resume library variable card heights", () => {
  it("places the next card after the full protected card and reflows when its content grows", async () => {
    const records = [
      { id: "protected", resumeAdmissionStatus: "protected", resumeParseStatus: "ready" },
      { id: "ordinary", resumeAdmissionStatus: "accepted", resumeParseStatus: "ready" },
    ] as Props["records"];
    const grid = {
      bind: { rowSelection: {} },
      setRowSelection: vi.fn(),
    } as unknown as Props["grid"];
    const container = document.createElement("div");
    fixture.viewport?.append(container);
    const root = createRoot(container);

    try {
      await act(() => {
        root.render(
          <ResumeLibraryCardList
            {...({
              empty: null,
              filters: [],
              grid,
              records,
              retriedRecordIds: new Set<string>(),
              total: 2,
            } as unknown as Props)}
          />,
        );
      });
      const protectedRow = container.querySelector<HTMLElement>(
        '[data-resume-record-id="protected"]',
      );
      const ordinaryRow = container.querySelector<HTMLElement>(
        '[data-resume-record-id="ordinary"]',
      );
      expect(protectedRow).not.toBeNull();
      expect(ordinaryRow?.style.transform).toBe("translateY(360px)");
      expect(protectedRow?.style.height).toBe("");
      expect(protectedRow?.style.minHeight).toBe("272px");

      await act(() => {
        if (protectedRow) {
          for (const observer of observers) {
            observer.resize(protectedRow, 520);
          }
        }
      });
      expect(ordinaryRow?.style.transform).toBe("translateY(520px)");
      expect(ordinaryRow?.parentElement?.style.height).toBe("792px");
    } finally {
      act(() => root.unmount());
    }
  });
});
