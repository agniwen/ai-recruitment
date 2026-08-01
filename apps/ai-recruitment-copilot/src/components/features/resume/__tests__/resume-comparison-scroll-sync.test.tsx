// @vitest-environment jsdom

import type * as ReactQuery from "@tanstack/react-query";
import type { ReactNode, Ref } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFViewerHandle } from "@/components/ui/pdf-viewer";
import { enableReactActEnvironment, renderInAct, unmountInAct } from "@/test-utils/react-act";
import { ResumeComparisonDialog } from "../resume-comparison-dialog";

enableReactActEnvironment();

const details = [
  {
    candidateEmail: null,
    candidateName: "当前候选人",
    candidatePhone: null,
    createdAt: "2026-07-24T08:00:00.000Z",
    creatorImage: null,
    creatorName: "当前上传人",
    hasResumeFile: true,
    jobDescriptionName: null,
    pipelineStage: "applied",
    resumeFileName: "current.pdf",
    resumeProfile: null,
    targetRole: null,
  },
  {
    candidateEmail: null,
    candidateName: "疑似候选人",
    candidatePhone: null,
    createdAt: "2026-07-25T08:00:00.000Z",
    jobDescriptionName: null,
    resumeFileName: "suspected.pdf",
    resumeProfile: null,
    resumeStorageKey: "resumes/suspected.pdf",
    status: "active",
    targetRole: null,
    uploaderEmail: null,
    uploaderImage: null,
    uploaderName: "疑似上传人",
  },
] as const;

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useQueries: () => details.map((data) => ({ data, isError: false, isLoading: false })),
}));

vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceSlug: () => "acme",
}));

vi.mock("@/lib/client/api", () => ({
  fetchResumePoolItem: vi.fn(),
  fetchStudioResume: vi.fn(),
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
}));

vi.mock("@/components/features/resume/resume-profile-view", () => ({
  ResumeProfileView: () => null,
}));

vi.mock("@/components/ui/docx-viewer", () => ({
  DocxViewerPreview: () => null,
}));

vi.mock("@/components/ui/xlsx-viewer", () => ({
  XlsxViewerPreview: () => null,
}));

vi.mock("@/components/features/pdf/pdf-preview-dialog", async () => {
  const React = await import("react");
  return {
    PdfPreviewContent: ({ url, viewerRef }: { url: string; viewerRef?: Ref<PDFViewerHandle> }) => {
      const viewportRef = React.useRef<HTMLDivElement>(null);
      React.useImperativeHandle(
        viewerRef,
        () => ({
          getViewportElement: () => viewportRef.current,
          scrollToPage: () => {},
          scrollToPageArea: () => {},
        }),
        [],
      );
      return (
        <div
          data-testid={url.includes("current-id") ? "document-current" : "document-suspected"}
          ref={viewportRef}
        />
      );
    },
  };
});

const roots: Awaited<ReturnType<typeof renderInAct>>["root"][] = [];

afterEach(async () => {
  for (const root of roots) {
    await unmountInAct(root);
  }
  roots.length = 0;
});

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
}

describe("ResumeComparisonDialog synchronized scrolling", () => {
  it.each(["details", "documents"] as const)(
    "syncs %s by percentage, allows independent scrolling, and realigns from the current resume",
    async (mode) => {
      const { root } = await renderInAct(
        <ResumeComparisonDialog
          current={{
            candidateName: "当前候选人",
            id: "current-id",
            sourceType: "studio_interview",
          }}
          mode={mode}
          onOpenChange={() => {}}
          open
          suspected={{
            candidateName: "疑似候选人",
            id: "suspected-id",
            sourceType: "resume_pool_item",
          }}
        />,
      );
      roots.push(root);

      const current = document.querySelector<HTMLElement>(
        mode === "documents"
          ? '[data-testid="document-current"]'
          : '[data-resume-compare-scroll-container="current"]',
      );
      const suspected = document.querySelector<HTMLElement>(
        mode === "documents"
          ? '[data-testid="document-suspected"]'
          : '[data-resume-compare-scroll-container="suspected"]',
      );
      const checkbox = document.querySelector<HTMLElement>('[data-slot="checkbox"]');
      expect(current).toBeTruthy();
      expect(suspected).toBeTruthy();
      expect(checkbox).toBeTruthy();
      expect(document.body.textContent).toContain("同步滚动");
      if (!(current && suspected && checkbox)) {
        throw new Error("expected both comparison viewports and the sync checkbox");
      }

      setScrollMetrics(current, 1000, 200);
      setScrollMetrics(suspected, 2000, 200);

      current.scrollTop = 400;
      current.dispatchEvent(new Event("scroll"));
      expect(suspected.scrollTop).toBe(900);

      act(() => checkbox.click());
      current.scrollTop = 600;
      current.dispatchEvent(new Event("scroll"));
      expect(suspected.scrollTop).toBe(900);

      current.scrollTop = 200;
      suspected.scrollTop = 1200;
      act(() => checkbox.click());
      expect(suspected.scrollTop).toBe(450);

      suspected.scrollTop = 1350;
      suspected.dispatchEvent(new Event("scroll"));
      expect(current.scrollTop).toBe(600);
    },
  );
});
