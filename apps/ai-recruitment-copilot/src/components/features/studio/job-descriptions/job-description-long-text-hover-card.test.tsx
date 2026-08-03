// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobDescriptionLongTextHoverCard } from "./job-description-long-text-hover-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
});

describe("JobDescriptionLongTextHoverCard", () => {
  it("opens a scrollable card with the complete field value", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const value = `岗位职责\n${"完整内容".repeat(120)}`;

    act(() => {
      root.render(
        <JobDescriptionLongTextHoverCard
          label="JD(必填) 岗位职责+任职要求"
          previewClassName="max-w-64"
          value={value}
        />,
      );
    });

    const trigger = host.querySelector("button");
    expect(trigger?.className).toContain("truncate");

    act(() => {
      const pointerEnter = new Event("pointerover", { bubbles: true });
      Object.defineProperty(pointerEnter, "pointerType", { value: "mouse" });
      trigger?.dispatchEvent(pointerEnter);
      trigger?.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(251);
    });

    expect(document.body.textContent).toContain(value);
    expect(document.body.querySelector('[data-slot="scroll-area"]')?.className).toContain(
      "max-h-72",
    );
    expect(document.body.querySelector('[data-slot="hover-card-content"]')).not.toBeNull();
  });
});
