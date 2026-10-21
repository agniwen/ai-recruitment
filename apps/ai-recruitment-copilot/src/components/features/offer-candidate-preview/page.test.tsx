// @vitest-environment jsdom
import type { OfferCandidatePreview } from "@arc/shared/offer-candidate-preview";
import { offerConfirmationDetailsSchema } from "@arc/db-schema/offer-confirmation";
import { resumeReviewV5Schema } from "@arc/shared/resume-review";
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
import { copyTextToClipboard } from "@/lib/client/clipboard";
import type * as ClipboardModule from "@/lib/client/clipboard";
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
vi.mock("@/components/ui/chart-radar", () => ({
  DimensionRadarChart: () => <div>评分雷达图</div>,
}));
vi.mock("@/lib/client/api", () => ({}));
vi.mock("@/lib/client/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof ClipboardModule>()),
  copyTextToClipboard: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
// Vitest does not apply Start's server-function transform to the shared review UI imports.
vi.mock("@/lib/start/auth-session", () => ({ getWorkspaceAccessState: vi.fn() }));
enableReactActEnvironment();

const dimension = { basis: "both", rationale: "项目实践与岗位要求相符", score: 82 };
const review = resumeReviewV5Schema.parse({
  detailedOverall: {
    judgment: "具备岗位所需的专业能力",
    matchingEvidence: "真实项目中的执行与交付记录",
    risks: "待复核跨团队合作经验",
  },
  dimensions: {
    educationBackground: dimension,
    experienceRelevance: dimension,
    potential: dimension,
    projectMatch: dimension,
    skillMatch: dimension,
    stability: dimension,
  },
  levelRecommendation: null,
  nextStep: {
    action: "interview",
    disclaimer: "以上为初步结论",
    interviewFocus: ["核实项目经历"],
    rationale: "建议结合复面记录确认",
  },
  overall: { baseScore: 82, conclusion: "岗位匹配良好", scoreRationale: "六维评分依据" },
  schemaVersion: 5,
  teamPositioning: null,
  version: 5,
});

const preview: OfferCandidatePreview = {
  aiReview: { generatedAt: "2026-10-18T00:00:00.000Z", review, status: "ready" },
  candidate: {
    hasResumeFile: true,
    name: "SSC测试候选人",
    profile: null,
    resumeFileName: "candidate.pdf",
  },
  humanInterviews: [
    {
      cancelledAt: null,
      completedAt: "2026-10-19T01:00:00.000Z",
      feedback: "沟通清晰，项目追问通过。",
      format: "online",
      interviewers: [{ name: "面试官甲" }, { name: "面试官乙" }],
      label: "技术复面",
      outcome: "pass",
      scheduledAt: "2026-10-19T00:00:00.000Z",
      score: 88,
      sortOrder: 0,
      status: "completed",
    },
  ],
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
  screening: {
    evaluatedAt: "2026-10-18T00:00:00.000Z",
    result: {
      policyEmpty: false,
      recommendation: "flag",
      ruleResults: [
        {
          evidence: [{ explanation: "实际交付项目", quote: "负责完整的招聘项目" }],
          label: "招聘项目经验",
          reason: "候选人具备相关的实际经验。",
          severity: "warning",
          status: "pass",
        },
      ],
    },
    status: "ready",
  },
};
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
let queryClient: QueryClient;

async function selectTab(label: string) {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (node) => node.textContent === label,
  );
  if (!tab) {
    throw new Error(`Missing public candidate tab: ${label}`);
  }
  await act(() => tab.click());
  await waitForUi(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
}

function expectReadOnly() {
  const controls = [...document.querySelectorAll("button, a")].map((node) => node.textContent);
  for (const action of [
    "重新评估",
    "编辑",
    "安排真人复面",
    "创建会议",
    "复制链接",
    "接收确认",
    "完成确认",
    "登录",
  ]) {
    expect(controls).not.toContain(action);
  }
}

async function renderPage() {
  rendered = await renderInAct(
    <QueryClientProvider client={queryClient}>
      <OfferCandidatePreviewPage token="test-token" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(fetchOfferCandidatePreview).mockReset().mockResolvedValue(preview);
  vi.mocked(copyTextToClipboard).mockReset().mockResolvedValue("copied");
  vi.mocked(ResumeDocumentPreviewModal).mockClear();
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  queryClient.clear();
  window.history.replaceState(null, "", "/");
  document.body.replaceChildren();
});

describe("public Offer candidate preview", () => {
  it("prefers the corrected candidate name over the parsed resume name", async () => {
    vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
      ...preview,
      candidate: {
        ...preview.candidate,
        name: "校正后的姓名",
        profile: {
          age: null,
          educationExperiences: [],
          email: null,
          gender: null,
          name: "简历解析旧姓名",
          personalStrengths: [],
          phone: null,
          projectExperiences: [],
          schools: [],
          skills: [],
          targetRoles: [],
          workExperiences: [],
          workYears: null,
        },
      },
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("校正后的姓名"));
    expect(document.body.textContent).not.toContain("简历解析旧姓名");
  });
  it("shows this candidate, job and Offer salary without login or approval controls", async () => {
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    for (const value of ["招聘专员", "测试中心", "岗位职责测试"]) {
      expect(document.body.textContent).toContain(value);
    }
    await selectTab("Offer");
    for (const value of [
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

  it.each([null, 0])(
    "hides missing annual bonus but preserves recorded zero in read-only preview: %s",
    async (bonus) => {
      vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
        ...preview,
        offer: { ...preview.offer, bonus },
      });
      await renderPage();
      await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
      await selectTab("Offer");
      expect(document.body.textContent?.includes("年度奖金")).toBe(bonus !== null);
    },
  );

  it("copies the complete Offer snapshot with its actual candidate record code and SSC status", async () => {
    vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
      ...preview,
      candidate: { ...preview.candidate, id: "candidate-public-actual" },
      offer: {
        ...preview.offer,
        confirmationInfo: {
          candidateCode: "PUBLIC-001",
          candidateName: "保存时的姓名",
          departmentName: "保存时的部门",
          directManager: null,
          gender: "女",
          hiringUnitName: "保存时的编制组织",
          interviewFeedback: "保存时确认的面试评价",
          interviewRoundId: null,
          jobLevel: "P6",
          jobType: null,
          mainInterviewerName: "保存的面试官",
          managementSequence: null,
          personnelType: null,
          probationPeriod: "3个月",
          probationSalary: 16_000,
          serviceUnit: null,
          workLocation: "上海",
          workMode: null,
        },
        sscConfirmationStatus: "completed",
      },
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    await selectTab("Offer");
    expect(document.body.textContent).toContain("PUBLIC-001");
    expect(document.body.textContent).toContain("保存时的编制组织");
    expect(document.body.textContent).toContain("保存时确认的面试评价");
    expect(document.body.textContent).toContain("offer审批已通过");
    expect(document.body.textContent).not.toContain("待 SSC 确认");
    const offer = document.querySelector<HTMLElement>("#offer-confirmation-info");
    const text = offer?.querySelector("pre")?.textContent;
    expect(text).toContain("系统记录编码：candidate-public-actual");
    expect(text).toContain("简历名：保存时的姓名");
    expect(text).toContain("转正薪资：18K");
    expect(text).toContain("试用薪资：16K");
    expect(text).toContain("offer审批已通过");
    expect(text?.length).toBeGreaterThan(256);
    const copy = [...(offer?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (node) => node.textContent?.trim() === "复制 Offer 信息",
    );
    expect(copy, "missing public Offer copy button").toBeDefined();
    await act(() => copy?.click());
    expect(copyTextToClipboard).toHaveBeenCalledExactlyOnceWith(text, expect.any(Function));
    expect(fetchOfferCandidatePreview).toHaveBeenCalledExactlyOnceWith("test-token");
    expectReadOnly();
  });

  it.each([null, undefined])(
    "copies historical Offers without a confirmation snapshot using the candidate name: %s",
    async (confirmationInfo) => {
      vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
        ...preview,
        candidate: { ...preview.candidate, id: "legacy-candidate" },
        offer: { ...preview.offer, confirmationInfo },
      });
      await renderPage();
      await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
      await selectTab("Offer");
      const offer = document.querySelector("#offer-confirmation-info");
      const text = offer?.querySelector("pre")?.textContent;
      expect(text).toContain("简历名：SSC测试候选人");
      expect(text).toContain("系统记录编码：legacy-candidate");
      expect(text).toContain("职位：高级招聘专员");
      expect(text).toContain("转正薪资：18K");
      expect(text).not.toContain("待 SSC 确认");
      expect(text?.split("\n").at(-1)).toBe("试用薪资：待补充");
      expect(offer?.textContent).toContain("待 SSC 接收");
      const copy = [...(offer?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (node) => node.textContent?.trim() === "复制 Offer 信息",
      );
      expect(copy, "missing historical Offer copy button").toBeDefined();
      await act(() => copy?.click());
      expect(copyTextToClipboard).toHaveBeenCalledExactlyOnceWith(text, expect.any(Function));
      expectReadOnly();
    },
  );

  it("preserves a deliberately empty candidate name in an existing Offer snapshot", async () => {
    vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
      ...preview,
      offer: {
        ...preview.offer,
        confirmationInfo: offerConfirmationDetailsSchema.parse({ candidateName: null }),
      },
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    await selectTab("Offer");
    const text = document.querySelector("#offer-confirmation-info pre")?.textContent;
    expect(text).toContain("简历名：待补充");
    expect(text).not.toContain("简历名：SSC测试候选人");
  });

  it("opens the Offer tab directly from the notification copy anchor", async () => {
    const scroll = vi.fn();
    const previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    window.history.replaceState(null, "", "#offer-confirmation-info");
    try {
      await renderPage();
      await waitForUi(() =>
        expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
          "Offer",
        ),
      );
      expect(document.querySelector("#offer-confirmation-info")?.textContent).toContain(
        "本次 Offer · v3",
      );
      expect(scroll).toHaveBeenCalled();
      expectReadOnly();
    } finally {
      if (previousScroll) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", previousScroll);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("shows the four original sections and their real review and interview records without auth requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected request"));
    try {
      await renderPage();
      await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
      expect(
        [...document.querySelectorAll('[role="tab"]')].map((node) => node.textContent),
      ).toEqual(["概览", "AI评分", "真人复面", "Offer"]);

      await selectTab("AI评分");
      for (const value of [
        "82 / 100",
        "岗位匹配良好",
        "具备岗位所需的专业能力",
        "真实项目中的执行与交付记录",
        "待复核跨团队合作经验",
      ]) {
        expect(document.body.textContent).toContain(value);
      }
      for (const value of [
        "岗位规则检查",
        "招聘项目经验",
        "候选人具备相关的实际经验。",
        "负责完整的招聘项目",
      ]) {
        expect(document.body.textContent).toContain(value);
      }
      expectReadOnly();
      await selectTab("真人复面");
      for (const value of [
        "技术复面",
        "已完成",
        "通过",
        "88",
        "沟通清晰，项目追问通过。",
        "面试官甲",
        "面试官乙",
        "线上",
      ]) {
        expect(document.body.textContent).toContain(value);
      }
      expectReadOnly();
      await selectTab("Offer");
      expect(document.body.textContent).toContain("18,000");
      expectReadOnly();
      await selectTab("概览");
      expect(document.body.textContent).toContain("打开简历");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(fetchOfferCandidatePreview).toHaveBeenCalledTimes(1);
      expectReadOnly();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("shows the original overview score and lets readers open the AI score details", async () => {
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    expect(document.body.textContent).toContain("综合评分");
    expect(document.body.textContent).toContain("评分雷达图");
    expect(document.body.textContent).toContain("岗位匹配良好");
    expect(document.body.textContent).toContain("候选人信息");
    expect(document.body.textContent).toContain("活动记录");
    const details = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "查看详情",
    );
    expect(details).toBeDefined();
    await act(() => details?.click());
    await waitForUi(() =>
      expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        "AI评分",
      ),
    );
    expectReadOnly();
  });

  it("keeps empty review and interview sections visible with accurate empty states", async () => {
    vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
      ...preview,
      aiReview: { generatedAt: null, review: null, status: "idle" },
      humanInterviews: [],
      screening: { evaluatedAt: null, result: null, status: "idle" },
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    await selectTab("AI评分");
    expect(document.body.textContent).toContain("暂无 AI 评分");
    await selectTab("真人复面");
    expect(document.body.textContent).toContain("暂无真人复面记录");
    expect(document.body.textContent).not.toContain("技术复面");
  });

  it("opens the original resume through the token-scoped binary endpoint", async () => {
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("打开简历"));
    const button = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("打开简历"),
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

  it.each([null, "original-resume", "candidate.html"])(
    "keeps an original resume entry when the file name cannot select a preview: %s",
    async (resumeFileName) => {
      vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
        ...preview,
        candidate: { ...preview.candidate, resumeFileName },
      });
      await renderPage();
      await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
      const link = [...document.querySelectorAll("a")].find((node) =>
        node.textContent?.includes("打开简历"),
      );
      expect(link?.getAttribute("href")).toBe("/api/public/offer-candidates/test-token/resume");
      expect(link?.hasAttribute("download")).toBe(true);
      expect(document.body.textContent).toContain("已上传原始简历");
      expect(document.body.textContent).not.toContain("暂无结构化简历");
      expect(vi.mocked(ResumeDocumentPreviewModal).mock.calls).toHaveLength(0);
    },
  );

  it("shows an inactive open entry when the candidate has no original resume", async () => {
    vi.mocked(fetchOfferCandidatePreview).mockResolvedValue({
      ...preview,
      candidate: { ...preview.candidate, hasResumeFile: false, resumeFileName: null },
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("SSC测试候选人"));
    const button = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("打开简历"),
    );
    expect(button?.disabled).toBe(true);
    expect(document.body.textContent).toContain("原始简历暂不可用");
    expect(document.body.textContent).toContain("暂无结构化简历");
    expect(document.querySelector('a[href$="/resume"]')).toBeNull();
    await act(() => button?.click());
    expect(vi.mocked(ResumeDocumentPreviewModal).mock.calls).toHaveLength(0);
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
