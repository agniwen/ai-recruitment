// @vitest-environment jsdom

import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CandidateOutcome, PipelineStage } from "@arc/db-schema/studio-interviews";
import {
  enableReactActEnvironment,
  installNoopResizeObserver,
  renderInAct,
  unmountInAct,
} from "@/test-utils/react-act";
import { ResumeDedupMatchList, ResumeDuplicateMatchesDialog } from "../resume-dedup-overlay";

enableReactActEnvironment();
installNoopResizeObserver();

vi.mock("@/lib/client/workspace-context", () => ({
  useOptionalWorkspaceSlug: () => "default",
  useWorkspaceCan: () => false,
  useWorkspaceSlug: () => "default",
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

const permissionMocks = vi.hoisted(() => ({
  resumeLibrary: true,
  resumePool: true,
}));

vi.mock("@/hooks/use-has-permission", () => ({
  useHasPermission: (resource: "resumeLibrary" | "resumePool") => permissionMocks[resource],
}));

vi.mock("@/components/features/studio/studio-person-detail-dialog", () => ({
  StudioPersonDetailDialog: () => null,
}));

const roots: Awaited<ReturnType<typeof renderInAct>>["root"][] = [];

afterEach(async () => {
  for (const root of roots) {
    await unmountInAct(root);
  }
  roots.length = 0;
  permissionMocks.resumeLibrary = true;
  permissionMocks.resumePool = true;
});

describe("ResumeDuplicateMatchesDialog", () => {
  it("keeps each historical destination and stage visible while resume summaries expand independently", async () => {
    const { root, container } = await renderInAct(
      <QueryClientProvider client={new QueryClient()}>
        <ResumeDedupMatchList
          matches={["技术中心", "渠道中心"].map((hiringUnitName, index) => ({
            candidateEmail: "candidate@example.com",
            candidateName: "刘鑫",
            candidatePhone: null,
            createdAt: "2026-10-14T10:20:00.000Z",
            departmentName: index === 0 ? "运营组" : "Agent开发部",
            hiringUnitName,
            id: `history-${index}`,
            jobDescriptionName: "前端开发工程师",
            outcome: "in_pipeline",
            pipelineStage: index === 0 ? "offer" : "human_interview",
            resumeProfileSnapshot: {
              education: [],
              educationHasMore: false,
              projects: [],
              projectsHasMore: false,
              work: [{ primary: "历史工作公司" }],
              workHasMore: false,
            },
            resumeSourceName: `${hiringUnitName}来源`,
            semanticReasons: ["工作经历高度相似"],
            skills: ["React", "TypeScript"],
            status: "active",
            targetRole: "前端开发",
          }))}
        />
      </QueryClientProvider>,
    );
    roots.push(root);

    const cards = container.querySelectorAll("article");
    expect(cards).toHaveLength(2);
    for (const [index, card] of [...cards].entries()) {
      const context = card.querySelector('[aria-label="投递去向"]');
      assert(context);
      expect(context.textContent).toContain(index === 0 ? "技术中心" : "渠道中心");
      expect(context.textContent).toContain(index === 0 ? "运营组" : "Agent开发部");
      expect(context.textContent).toContain(index === 0 ? "Offer" : "真人复面");
      expect(context.textContent).toContain("投递岗位");
      expect(context.closest("details")).toBeNull();
      expect(card.querySelector("details")?.open).toBe(false);
    }

    const firstSummary = cards[0]?.querySelector("details");
    assert(firstSummary);
    const toggle = firstSummary.querySelector("summary");
    assert(toggle);
    expect(firstSummary.textContent).toContain("历史工作公司");
    expect(firstSummary.textContent).toContain("React");
    toggle.click();
    expect(firstSummary.open).toBe(true);
    expect(cards[1]?.querySelector("details")?.open).toBe(false);
    toggle.click();
    expect(firstSummary.open).toBe(false);
  });

  it("shows recruiting context and uploaders for the current candidate and suspected records", async () => {
    const queryClient = new QueryClient();
    const { root } = await renderInAct(
      <QueryClientProvider client={queryClient}>
        <ResumeDuplicateMatchesDialog
          matches={[
            {
              candidateEmail: "suspected@example.com",
              candidateName: "疑似候选人",
              candidatePhone: null,
              createdAt: "2026-07-24T00:00:00.000Z",
              departmentName: "历史投递部门",
              hiringUnitName: "历史用人组织",
              id: "suspected-id",
              jobDescriptionName: null,
              level: "high",
              outcome: "in_pipeline",
              pipelineStage: "offer",
              resumeSourceName: "历史来源中心",
              score: 94,
              status: "active",
              targetRole: null,
              uploaderImage: "https://example.com/suspected.png",
              uploaderName: "疑似上传人",
            },
          ]}
          onOpenChange={() => {}}
          open
          source={{
            candidateEmail: "current@example.com",
            candidateName: "当前候选人",
            candidatePhone: null,
            createdAt: "2026-07-24T00:00:00.000Z",
            departmentName: "当前投递部门",
            hiringUnitName: "当前用人组织",
            id: "current-id",
            jobDescriptionName: null,
            outcome: "in_pipeline",
            pipelineStage: "screening",
            resumeProfileSnapshot: null,
            resumeSourceName: "当前来源中心",
            skills: [],
            targetRole: null,
            uploaderImage: "https://example.com/current.png",
            uploaderName: "当前上传人",
          }}
        />
      </QueryClientProvider>,
    );
    roots.push(root);

    expect(document.body.textContent).toContain("上传人");
    expect(document.body.textContent).toContain("当前上传人");
    expect(document.body.textContent).toContain("疑似上传人");
    for (const label of ["用人组织", "部门/中心（来源）", "部门", "当前环节"]) {
      expect(document.body.textContent).toContain(label);
    }
    const currentPanelText = document.querySelector("aside")?.textContent;
    expect(currentPanelText).toContain("当前用人组织");
    expect(currentPanelText).toContain("当前来源中心");
    expect(currentPanelText).toContain("当前投递部门");
    expect(currentPanelText).toContain("待评估");
    expect(currentPanelText).not.toContain("历史用人组织");
    expect(document.body.textContent).toContain("历史用人组织");
    expect(document.body.textContent).toContain("历史来源中心");
    expect(document.body.textContent).toContain("历史投递部门");
    expect(document.body.textContent).toContain("Offer");
    const riskBadge = [...document.querySelectorAll<HTMLElement>('[data-slot="badge"]')].find(
      (element) => element.textContent === "高度疑似 94%",
    );
    expect(riskBadge).toBeTruthy();
    expect(riskBadge?.className).toContain("rounded-sm");
    expect(riskBadge?.className).toContain("px-2.5");
    expect(riskBadge?.className).toContain("py-1");
    expect(riskBadge?.className).toContain("font-normal");
    expect(riskBadge?.className).not.toContain("px-1.5");
    expect(riskBadge?.className).not.toContain("py-0.5");
    const uploaderLabel = [...document.querySelectorAll("span")].find(
      (element) => element.textContent === "上传人",
    );
    expect(uploaderLabel?.parentElement?.className).toContain("grid-cols-[3rem_minmax(0,1fr)]");
    expect(uploaderLabel?.parentElement?.className).toContain("gap-x-2");
    const avatars = document.querySelectorAll<HTMLElement>('[data-slot="avatar"]');
    expect(avatars.length).toBeGreaterThanOrEqual(2);
    for (const avatar of avatars) {
      expect(avatar.className).toContain("size-4");
      expect(avatar.dataset.size).toBe("default");
    }

    const detailButton = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "查看",
    );
    const resumeButton = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "简历",
    );
    expect(detailButton?.className).toContain("hidden");
    expect(detailButton?.className).toContain("lg:inline-flex");
    expect(resumeButton?.className).toContain("hidden");
    expect(resumeButton?.className).toContain("lg:inline-flex");
  });

  it.each<[PipelineStage, CandidateOutcome, string]>([
    ["screening", "in_pipeline", "待评估"],
    ["ai_review", "in_pipeline", "AI 评价审核"],
    ["written_test", "in_pipeline", "笔试"],
    ["ai_interview", "in_pipeline", "AI 面试"],
    ["human_interview", "in_pipeline", "真人复面"],
    ["offer", "in_pipeline", "Offer"],
    ["closed", "archived", "已归档"],
    ["closed", "rejected", "已淘汰"],
    ["closed", "hired", "已到岗"],
    ["closed", "withdrawn", "已撤回"],
  ])("shows the actual stage for %s / %s", async (pipelineStage, outcome, label) => {
    const { root, container } = await renderInAct(
      <QueryClientProvider client={new QueryClient()}>
        <ResumeDedupMatchList
          matches={[
            {
              candidateEmail: null,
              candidateName: "疑似候选人",
              candidatePhone: null,
              createdAt: "2026-07-24T00:00:00.000Z",
              id: "suspected-id",
              jobDescriptionName: null,
              outcome,
              pipelineStage,
              sourceType: "studio_interview",
              status: pipelineStage === "closed" ? "archived" : "active",
              targetRole: null,
            },
          ]}
        />
      </QueryClientProvider>,
    );
    roots.push(root);

    expect(container.textContent).toContain(label);
    if (outcome !== "archived") {
      expect(container.textContent).not.toContain("已归档");
    }
  });

  it("hides cross-resource comparison actions without permission to read both sides", async () => {
    permissionMocks.resumeLibrary = false;
    const queryClient = new QueryClient();
    const { root } = await renderInAct(
      <QueryClientProvider client={queryClient}>
        <ResumeDedupMatchList
          matches={[
            {
              candidateEmail: null,
              candidateName: "招聘台候选人",
              candidatePhone: null,
              createdAt: "2026-07-24T00:00:00.000Z",
              id: "studio-1",
              jobDescriptionName: null,
              sourceType: "studio_interview",
              status: "active",
              targetRole: null,
            },
          ]}
          source={{
            candidateEmail: null,
            candidateName: "人才库候选人",
            candidatePhone: null,
            id: "pool-1",
            jobDescriptionName: null,
            resumeProfileSnapshot: null,
            skills: [],
            sourceType: "resume_pool_item",
            targetRole: null,
          }}
        />
      </QueryClientProvider>,
    );
    roots.push(root);

    const actionLabels = [...document.querySelectorAll("button")].map((button) =>
      button.textContent?.trim(),
    );
    expect(actionLabels).not.toContain("查看");
    expect(actionLabels).not.toContain("简历");
  });
});
