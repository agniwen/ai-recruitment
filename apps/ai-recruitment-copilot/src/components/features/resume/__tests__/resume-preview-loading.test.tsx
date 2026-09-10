// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumeDocumentPreviewDialog } from "../resume-document-preview-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const viewers = vi.hoisted(() => ({
  docx: vi.fn(),
  pdf: vi.fn(),
  pending: Promise.withResolvers<never>().promise,
  xlsx: vi.fn(),
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({
    children,
    open,
    title,
    headerExtra,
  }: {
    children: ReactNode;
    open: boolean;
    title: ReactNode;
    headerExtra: ReactNode;
  }) =>
    open ? (
      <dialog open>
        {title}
        {headerExtra}
        {children}
      </dialog>
    ) : null,
}));
vi.mock("@/components/ui/pdf-viewer", () => ({
  PDFViewer: () => {
    viewers.pdf();
    throw viewers.pending;
  },
}));
vi.mock("@/components/ui/docx-viewer", () => ({
  DocxViewerPreview: () => {
    viewers.docx();
    throw viewers.pending;
  },
}));
vi.mock("@/components/ui/xlsx-viewer", () => ({
  XlsxViewerPreview: () => {
    viewers.xlsx();
    throw viewers.pending;
  },
}));

afterEach(() => vi.clearAllMocks());

describe("preview loading", () => {
  it.each(["pdf", "docx", "xlsx"] as const)(
    "opens and closes the %s shell while its viewer is suspended",
    async (kind) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const onOpenChange = vi.fn();
      try {
        await act(async () => {
          root.render(
            <ResumeDocumentPreviewDialog
              filename="候选人简历"
              kind={kind}
              onOpenChange={onOpenChange}
              open
              url="/resume-file"
            />,
          );
          await vi.dynamicImportSettled();
        });
        expect(container.querySelector("dialog")?.textContent).toContain("候选人简历");
        expect(container.querySelector("output")?.textContent).toContain("加载中");
        act(() => {
          container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
        });
        expect(onOpenChange).toHaveBeenCalledWith(false);
        for (const other of ["pdf", "docx", "xlsx"] as const) {
          if (other !== kind) {
            expect(viewers[other]).not.toHaveBeenCalled();
          }
        }
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    },
  );
});
