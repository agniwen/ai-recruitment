import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(new URL("../route.ts", import.meta.url), "utf-8");

describe("candidate transition route source", () => {
  it("requires a reactivation reason when restoring a closed candidate", () => {
    expect(routeSource).toContain("reactivationReason");
    expect(routeSource).toContain('kind: "missing_reactivation_reason"');
    expect(routeSource).toContain("请填写重新激活原因。");
  });

  it("blocks creating human interview rounds after the candidate reaches offer", () => {
    expect(routeSource).toContain('candidate.pipelineStage === "offer"');
    expect(routeSource).toContain("候选人已进入 Offer 阶段，不能再新建真人面试轮次。");
  });
});
