import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("pipeline-stage-action-bar.tsx", import.meta.url), "utf-8");

describe("PipelineStageActionBar floating actions", () => {
  it("renders compact current-stage actions for the shared floating surface", () => {
    expect(source).toContain("aria-label={`当前招聘阶段：");
    expect(source).toContain("pipelineStageMeta[pipelineStage].label");
    expect(source).toContain("<RecruitmentStageHoverCard");
    expect(source).toContain("完整招聘流程");
    expect(source).toContain('className="flex flex-wrap items-center justify-end gap-2"');
    expect(source).not.toContain("grid list-none overflow-x-auto");
  });

  it("shows current and completed stages in the hover flow", () => {
    const hoverSource = source.slice(
      source.indexOf("function RecruitmentStageHoverCard"),
      source.indexOf("interface StageButton"),
    );

    expect(hoverSource).toContain("const isCurrent = stage === pipelineStage;");
    expect(hoverSource).toContain("const isDone = currentIndex !== -1 && index < currentIndex;");
    expect(hoverSource).toContain("当前");
  });

  it("groups the primary resume actions together", () => {
    expect(source).toContain("primaryAction?: ReactNode;");
    expect(source).toContain('import { ButtonGroup } from "@/components/ui/button-group";');
    expect(source).toContain("<ButtonGroup");
    expect(source).toContain("{groupedPrimaryAction}");
    expect(source).toContain("const hasPrimaryActions =");
    expect(source).toContain("Boolean(groupedPrimaryAction)");
    expect(source).toContain("安排真人面试");
    expect(source).toContain('key: "to-offer"');
    expect(source).not.toContain(
      '<Button key="to-offer" onClick={() => onAdvance("offer")} size="sm" variant="outline">',
    );
  });

  it("suppresses external primary actions after the candidate is closed", () => {
    const renderSource = source.slice(
      source.indexOf("const actions = getStageActions"),
      source.indexOf("const DEFAULT_FLOW_STEPS"),
    );
    const closedSource = source.slice(
      source.indexOf('if (pipelineStage === "closed")'),
      source.indexOf("const buttons: StageButton[]"),
    );

    expect(renderSource).toContain(
      'const groupedPrimaryAction = pipelineStage === "closed" ? null : primaryAction;',
    );
    expect(renderSource).toContain("Boolean(groupedPrimaryAction)");
    expect(renderSource).toContain("{groupedPrimaryAction}");
    expect(closedSource).toContain('key="reactivate"');
    expect(closedSource).not.toContain("primaryAction");
  });

  it("shows the complete recruitment flow from the current-stage hover card", () => {
    expect(source).toContain("const DEFAULT_FLOW_STEPS");
    expect(source).toContain("const WRITTEN_TEST_FLOW_STEPS");
    expect(source).toContain("getHoverFlowSteps");
  });

  it("gates human interview and offer stage actions by create permissions", () => {
    expect(source).toContain("canCreateHumanInterview?: boolean;");
    expect(source).toContain("canCreateOffer?: boolean;");
    expect(source).toContain("hasJobDescription?: boolean;");
    expect(source).toContain("canCreateHumanInterview = true");
    expect(source).toContain("canCreateOffer = true");
    expect(source).toContain("&& canCreateHumanInterview");
    expect(source).toContain("if (canCreateOffer) {");
    expect(source).toContain('hasEvent({ type: "SKIP_TO_HUMAN_INTERVIEW" })');
    expect(source).toContain('hasEvent({ type: "ADVANCE_TO_OFFER" })');
    expect(source).toContain("canApplyCandidatePipelineEvent");
    expect(source).not.toContain("getCandidatePipelineEvents");
  });

  it("requires a bound job before arranging human interview", () => {
    expect(source).toContain("hasJobDescription = true");
    expect(source).toContain("resolveHumanInterviewAdvanceDisabledReason");
    expect(source).toContain("请先绑定在招岗位后再安排真人面试");
    expect(source).toContain('hasEvent({ type: "SKIP_TO_HUMAN_INTERVIEW" })');
    expect(source).toContain('hasEvent({ type: "ADVANCE_TO_HUMAN_INTERVIEW" })');
    expect(source).toContain("HumanInterviewAdvanceButton");
  });

  it("keeps the AI interview next-step human interview button primary", () => {
    const aiStageSource = source.slice(
      source.indexOf('case "ai_interview":'),
      source.indexOf('case "human_interview":'),
    );

    expect(aiStageSource).toContain('hasEvent({ type: "ADVANCE_TO_HUMAN_INTERVIEW" })');
    expect(aiStageSource).toContain("<HumanInterviewAdvanceButton");
    expect(aiStageSource).not.toContain('variant={aiInterviewDone ? "default" : "outline"}');
    expect(aiStageSource).not.toContain('variant="outline"');
  });

  it("does not expose direct offer or backward stage actions", () => {
    expect(source).not.toContain("直接发 Offer");
    expect(source).not.toContain('onAdvance("offer")');
    expect(source).not.toContain("退回 AI 面试");
    expect(source).not.toContain("退回真人复面");
  });

  it("requires completed human interview feedback before advancing to offer", () => {
    expect(source).toContain("humanInterviewFeedbackComplete?: boolean;");
    expect(source).toContain("resolveOfferAdvanceDisabledReason");
    expect(source).toContain("OfferAdvanceButton");
    expect(source).toContain("aria-disabled={Boolean(disabledReason)}");
    expect(source).toContain("请先完成所有真人面试轮次，并补全每轮面试评价");
    expect(source).toContain("<TooltipTrigger render={button} />");
    expect(source).toContain("humanInterviewFeedbackComplete");
  });

  it("keeps the action component presentation-only", () => {
    expect(source).toContain("component is presentation-only and stateless");
    expect(source).toContain("onAdvance(targetStage);");
    expect(source).toContain("onClick={onRequestClose}");
    expect(source).toContain("onClick={onRequestReactivate}");
    expect(source).not.toContain("pendingFlowActionRef");
  });
});
