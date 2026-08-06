import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("../route.ts", import.meta.url), "utf-8");
const transitionSource = readFileSync(
  new URL("../utils/candidate-stage-transition.ts", import.meta.url),
  "utf-8",
);
const transitionRulesSource = readFileSync(
  new URL("../utils/candidate-transition.ts", import.meta.url),
  "utf-8",
);
const humanRouteSource = readFileSync(new URL("../human-route.ts", import.meta.url), "utf-8");

describe("candidate transition route source", () => {
  it("requires a reactivation reason when restoring a closed candidate", () => {
    expect(routeSource).toContain("reactivationReason");
    expect(transitionRulesSource).toContain("请填写重新激活原因。");
  });

  it("blocks creating human interview rounds after the candidate reaches offer", () => {
    expect(humanRouteSource).toContain('candidate.pipelineStage === "offer"');
    expect(humanRouteSource).toContain("候选人已进入 Offer 阶段，不能再新建真人面试轮次。");
  });

  it("authorizes stage transitions by target stage permission, not blanket interview:update", () => {
    // Route must not hard-require interview:update; late-stage roles (ODC) only hold offer:*.
    const start = routeSource.indexOf('"/:id/transition"');
    const end = routeSource.indexOf('"/:id/candidate-expectations"');
    const transitionHandler = routeSource.slice(start, end);
    expect(transitionHandler).toContain("transitionCandidateStage");
    expect(transitionHandler).not.toContain('requirePermission("interview", "update")');
    expect(transitionSource).toContain('resource: "offer"');
    expect(transitionSource).toContain('resource: "humanInterview"');
    expect(transitionSource).toContain('resource: "interview"');
    expect(transitionSource).toContain('action: "create"');
    expect(transitionSource).toContain('action: "update"');
  });
});
