import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("transition-candidate-dialog.tsx", import.meta.url), "utf-8");

describe("TransitionCandidateDialog reactivation reason", () => {
  it("requires a reason and submits it with the reactivation request", () => {
    expect(source).toContain('id="reactivation-reason"');
    expect(source).toContain("setReactivationReason");
    expect(source).toContain("reactivationReason: trimmedReason");
    expect(source).toContain(
      "disabled={submitting || isLoading || !candidate || !reactivationReason.trim()}",
    );
  });
});
