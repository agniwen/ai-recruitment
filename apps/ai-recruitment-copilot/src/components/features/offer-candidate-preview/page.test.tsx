// @vitest-environment jsdom
import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { fetchOfferCandidatePreview } from "@/lib/client/api/endpoints/offer-candidate-preview";
import { ResumeDocumentPreviewModal } from "@/components/features/resume/resume-document-preview-modal";
import { OfferCandidatePreviewPage } from "./page";

vi.mock("@/lib/client/api/endpoints/offer-candidate-preview", () => ({
  fetchOfferCandidatePreview: vi.fn(),
  offerCandidateResumeUrl: (token: string) =>
    `/api/public/offer-candidates/${encodeURIComponent(token)}/resume`,
}));
vi.mock("@/components/features/resume/resume-profile-view", () => ({
  ResumeProfileView: ({ profile }: { profile: unknown }) => (
    <div>{profile ? "结构化简历内容" : "暂无结构化简历"}</div>
  ),
}));
vi.mock("@/components/features/resume/resume-document-preview-modal", () => ({
  ResumeDocumentPreviewModal: vi.fn(() => null),
}));
enableReactActEnvironment();

const preview: OfferCandidatePreview = {
  candidate: {
    hasResumeFile: true,
    name: "SSC测试候选人",
    profile: null,
    resumeFileName: "candidate.pdf",
  },
  job: { departmentName: "测试中心", description: "岗位职责测试", name: "招聘专员" },
  linkExpiresAt: "2026-10-26T00:00:00.000Z",
  offer: {
    baseSalary: 18_000,
    bonus: 36_000,
    currency: "CNY",
    equity: "100股",
    expiresAt: "2026-11-01T00:00:00.000Z",
    id: "offer-test",
    joiningDate: "2026-11-02",
    notes: "本次Offer备注",
    position: "高级招聘专员",
    sscCompletedAt: null,
    sscConfirmationStatus: "pending",
    sscReceivedAt: null,
    version: 3,
  },
};
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
let queryClient: QueryClient;

async function renderPage() {
  rendered = await renderInAct(
    <QueryClientProvider client={queryClient}>
      <OfferCandidatePreviewPage token="test-token" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(fetchOfferCandidatePreview).mockReset().mockResolvedValue(preview);
  vi.mocked(ResumeDocumentPreviewModal).mockClear();
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  queryClient.clear();
  document.body.replaceChildren();
});

describe("public Offer candidate preview", () => {
  it("shows this candidate, job and Offer salary without login or approval controls", async () => {
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    for (const value of [
      "招聘专员",
      "测试中心",
      "岗位职责测试",
      "高级招聘专员",
      "18,000",
      "36,000",
      "100股",
      "本次Offer备注",
      "待 SSC 接收",
    ]) {
      expect(document.body.textContent).toContain(value);
    }
    expect(fetchOfferCandidatePreview).toHaveBeenCalledWith("test-token");
    expect(document.body.textContent).not.toContain("登录");
    expect(document.body.textContent).not.toContain("完成确认");
    expect(document.body.textContent).not.toContain("接收确认");
  });

  it("opens the original resume through the token-scoped binary endpoint", async () => {
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("查看原始简历"));
    const button = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("查看原始简历"),
    );
    if (!button) {
      throw new Error("Missing resume preview button");
    }
    await act(() => button.click());
    expect(vi.mocked(ResumeDocumentPreviewModal).mock.calls.at(-1)?.[0]).toMatchObject({
      fileName: "candidate.pdf",
      url: "/api/public/offer-candidates/test-token/resume",
    });
  });

  it("keeps a usable empty state when the candidate has no resume file or profile", async () => {
    vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
      ...preview,
      candidate: { ...preview.candidate, hasResumeFile: false, resumeFileName: null },
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    expect(document.body.textContent).toContain("暂无结构化简历");
    expect(document.body.textContent).not.toContain("查看原始简历");
    expect(document.querySelector('a[href$="/resume"]')).toBeNull();
  });

  it.each([null, new Error("private backend details")])(
    "shows a uniform unavailable message without leaking backend errors for %s",
    async (result) => {
      if (result instanceof Error) {
        vi.mocked(fetchOfferCandidatePreview).mockRejectedValue(result);
      } else {
        vi.mocked(fetchOfferCandidatePreview).mockResolvedValue(result);
      }
      await renderPage();
      await waitForUi(() => expect(document.body.textContent).toContain("链接已失效或不可用"));
      expect(document.body.textContent).not.toContain("private backend details");
      expect(document.body.textContent).not.toContain("SSC测试候选人");
    },
  );
});
