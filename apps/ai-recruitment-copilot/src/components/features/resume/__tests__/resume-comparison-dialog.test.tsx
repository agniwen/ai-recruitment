// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  installNoopResizeObserver,
  renderInAct,
  unmountInAct,
} from "@/test-utils/react-act";
import { ResumeComparisonDialog } from "../resume-comparison-dialog";

enableReactActEnvironment();
installNoopResizeObserver();

const { fetchResumePoolItem, fetchStudioResume } = vi.hoisted(() => ({
  fetchResumePoolItem: vi.fn(),
  fetchStudioResume: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  fetchResumePoolItem,
  fetchStudioResume,
}));

vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceSlug: () => "default",
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../resume-document-preview-dialog", () => ({
  ResumeDocumentPreviewPane: ({
    filename,
    kind,
    url,
  }: {
    filename?: string;
    kind: string;
    url: string;
  }) => (
    <div
      data-filename={filename}
      data-kind={kind}
      data-testid="resume-document-preview"
      data-url={url}
    />
  ),
}));

const roots: Awaited<ReturnType<typeof renderInAct>>["root"][] = [];

afterEach(async () => {
  for (const root of roots) {
    await unmountInAct(root);
  }
  roots.length = 0;
  vi.clearAllMocks();
});

function detail(candidateName: string, resumeFileName: string | null) {
  return {
    candidateEmail: `${candidateName}@example.com`,
    candidateName,
    candidatePhone: "13800000000",
    createdAt: "2026-07-29T02:30:00.000Z",
    creatorName: "招聘台上传人",
    hasResumeFile: true,
    jobDescriptionName: "产品经理",
    resumeFileName,
    resumeProfile: null,
    targetRole: "高级产品经理",
  };
}

async function renderComparison(mode: "details" | "documents") {
  fetchStudioResume.mockResolvedValue(detail("当前候选人", "current.pdf"));
  fetchResumePoolItem.mockResolvedValue({
    ...detail("疑似候选人", "suspected.pdf"),
    createdAt: "2026-07-30T03:45:00.000Z",
    resumeStorageKey: "resumes/suspected.pdf",
    uploaderEmail: "pool-uploader@example.com",
    uploaderName: null,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = await renderInAct(
    <QueryClientProvider client={queryClient}>
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
      />
    </QueryClientProvider>,
  );
  roots.push(rendered.root);
}

describe("ResumeComparisonDialog", () => {
  it("shows current and suspected parsed details side by side", async () => {
    await renderComparison("details");

    expect(document.body.textContent).toContain("当前简历");
    expect(document.body.textContent).toContain("疑似简历");
    expect(document.body.textContent).toContain("当前候选人@example.com");
    expect(document.body.textContent).toContain("疑似候选人@example.com");
    expect(document.body.textContent).toContain("招聘台上传人");
    expect(document.body.textContent).toContain("pool-uploader@example.com");
    expect(document.body.textContent).toContain("招聘台");
    expect(document.body.textContent).toContain("人才库");
    expect(document.body.textContent).toContain("招聘流程中");
    expect(document.querySelectorAll("time")).toHaveLength(2);
  });

  it("shows both original resume documents with the correct endpoints", async () => {
    await renderComparison("documents");

    const previews = document.querySelectorAll<HTMLElement>(
      '[data-testid="resume-document-preview"]',
    );
    expect(previews).toHaveLength(2);
    expect(previews[0]?.dataset.url).toBe("/api/w/default/studio/resumes/current-id/resume");
    expect(previews[1]?.dataset.url).toBe("/api/w/default/studio/resume-pool/suspected-id/resume");
    const downloads = document.querySelectorAll<HTMLAnchorElement>("a[download]");
    expect(downloads).toHaveLength(2);
    expect(downloads[0]?.getAttribute("href")).toBe(
      "/api/w/default/studio/resumes/current-id/resume",
    );
    expect(downloads[1]?.getAttribute("href")).toBe(
      "/api/w/default/studio/resume-pool/suspected-id/resume",
    );
    expect(document.body.textContent).toContain("招聘台上传人");
    expect(document.body.textContent).toContain("pool-uploader@example.com");
    expect(document.querySelectorAll("time")).toHaveLength(2);
  });

  it("previews legacy resume files without filenames as PDF documents", async () => {
    fetchStudioResume.mockResolvedValue(detail("当前候选人", null));
    fetchResumePoolItem.mockResolvedValue({
      ...detail("疑似候选人", null),
      resumeStorageKey: "resumes/suspected.pdf",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = await renderInAct(
      <QueryClientProvider client={queryClient}>
        <ResumeComparisonDialog
          current={{ candidateName: "当前候选人", id: "current-id" }}
          mode="documents"
          onOpenChange={() => {}}
          open
          suspected={{
            candidateName: "疑似候选人",
            id: "suspected-id",
            sourceType: "resume_pool_item",
          }}
        />
      </QueryClientProvider>,
    );
    roots.push(rendered.root);

    expect(document.querySelectorAll('[data-testid="resume-document-preview"]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain("暂不支持预览");
  });

  it("uses converted PDF endpoints to preview PPTX while downloading the originals", async () => {
    fetchStudioResume.mockResolvedValue(detail("当前候选人", "current.pptx"));
    fetchResumePoolItem.mockResolvedValue({
      ...detail("疑似候选人", "suspected.pptx"),
      resumeStorageKey: "resumes/suspected.pptx",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = await renderInAct(
      <QueryClientProvider client={queryClient}>
        <ResumeComparisonDialog
          current={{ candidateName: "当前候选人", id: "current-id" }}
          mode="documents"
          onOpenChange={() => {}}
          open
          suspected={{
            candidateName: "疑似候选人",
            id: "suspected-id",
            sourceType: "resume_pool_item",
          }}
        />
      </QueryClientProvider>,
    );
    roots.push(rendered.root);

    const previews = document.querySelectorAll<HTMLElement>(
      '[data-testid="resume-document-preview"]',
    );
    expect(previews[0]?.dataset.kind).toBe("pdf");
    expect(previews[0]?.dataset.url).toBe(
      "/api/w/default/studio/resumes/current-id/resume-preview.pdf",
    );
    expect(previews[1]?.dataset.url).toBe(
      "/api/w/default/studio/resume-pool/suspected-id/resume-preview.pdf",
    );
    const downloads = document.querySelectorAll<HTMLAnchorElement>("a[download]");
    expect(downloads[0]?.getAttribute("href")).toBe(
      "/api/w/default/studio/resumes/current-id/resume",
    );
    expect(downloads[1]?.getAttribute("href")).toBe(
      "/api/w/default/studio/resume-pool/suspected-id/resume",
    );
  });
});
