// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ResumeDocumentPreviewDialogProps } from "../resume-document-preview-dialog";
import { ResumeDocumentPreviewModal } from "../resume-document-preview-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../resume-document-preview-dialog", () => ({
  ResumeDocumentPreviewDialog: ({
    open,
    url,
    onOpenChange,
    onOpenChangeComplete,
  }: ResumeDocumentPreviewDialogProps) => (
    <div data-open={open} data-preview-url={url}>
      <button onClick={() => onOpenChange(false)} type="button">
        关闭
      </button>
      <button onClick={() => onOpenChangeComplete?.(false)} type="button">
        完成退出
      </button>
    </div>
  ),
}));

it("opens after mounting and retains its payload until the exit completes", () => {
  let frame: FrameRequestCallback | undefined;
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The test controls the browser frame callback explicitly.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  const root = createRoot(container);
  const onClose = vi.fn();
  try {
    act(() =>
      root.render(
        <ResumeDocumentPreviewModal fileName="resume.pdf" onClose={onClose} url="/file" />,
      ),
    );
    expect(container.querySelector<HTMLElement>("[data-open]")?.dataset.open).toBe("false");
    act(() => frame?.(0));
    expect(container.querySelector<HTMLElement>("[data-open]")?.dataset.open).toBe("true");
    act(() => container.querySelectorAll("button")[0]?.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLElement>("[data-preview-url]")?.dataset.previewUrl).toBe(
      "/file",
    );
    expect(container.querySelector<HTMLElement>("[data-open]")?.dataset.open).toBe("false");
    act(() => container.querySelectorAll("button")[1]?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-preview-url]")).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
