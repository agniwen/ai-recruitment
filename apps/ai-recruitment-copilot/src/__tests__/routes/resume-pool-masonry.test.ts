import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResumePoolMasonry } from "../../components/features/studio/resume-pool/resume-pool-masonry";

const capture = vi.hoisted(() => ({ breakpoints: vi.fn() }));
vi.mock("react-responsive-masonry", () => ({
  ResponsiveMasonry: ({
    children,
    columnsCountBreakPoints,
  }: {
    children: ReactNode;
    columnsCountBreakPoints: Record<number, number>;
  }) => {
    capture.breakpoints(columnsCountBreakPoints);
    return children;
  },
  default: ({ children }: { children: ReactNode }) => children,
}));

describe("resume pool masonry", () => {
  it("keeps the one-to-four-column layout and renders the supplied cards", () => {
    const html = renderToStaticMarkup(
      createElement(ResumePoolMasonry, null, createElement("article", null, "候选人")),
    );
    expect(capture.breakpoints).toHaveBeenCalledWith({ 0: 1, 1024: 2, 1280: 3, 1440: 4 });
    expect(html).toContain("<article>候选人</article>");
  });
});
