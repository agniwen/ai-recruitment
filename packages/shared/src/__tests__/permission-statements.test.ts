import { describe, expect, it } from "vitest";
import {
  clonePermissionStatements,
  hasPermissionInStatements,
  isResumeEvaluationDisabled,
  normalizePermissionStatements,
} from "@arc/shared/permission-statements";

describe("permission-statements", () => {
  it("checks resource/action membership", () => {
    const statements = {
      interview: ["create", "read"],
      page: ["resumes"],
    };

    expect(hasPermissionInStatements(statements, "interview", "create")).toBe(true);
    expect(hasPermissionInStatements(statements, "interview", "delete")).toBe(false);
    expect(hasPermissionInStatements(statements, "page", "resumes")).toBe(true);
    expect(hasPermissionInStatements(undefined, "page", "resumes")).toBe(false);
  });

  it("treats disableResumeEvaluation as a deny flag except for owner/admin", () => {
    const disabled = { disableResumeEvaluation: ["create"] as "create"[] };
    expect(isResumeEvaluationDisabled(disabled, "02-recruitment-specialist")).toBe(true);
    expect(isResumeEvaluationDisabled(disabled, "member")).toBe(true);
    expect(isResumeEvaluationDisabled(disabled, "owner")).toBe(false);
    expect(isResumeEvaluationDisabled(disabled, "admin")).toBe(false);
    expect(isResumeEvaluationDisabled({}, "member")).toBe(false);
    expect(isResumeEvaluationDisabled(undefined, "member")).toBe(false);
  });

  it("normalizes unknown and invalid permission blobs", () => {
    expect(normalizePermissionStatements(null)).toEqual({});
    expect(normalizePermissionStatements("nope")).toEqual({});
    expect(
      normalizePermissionStatements({
        empty: [],
        interview: ["create", 1, "read"],
        page: "resumes",
      }),
    ).toEqual({
      interview: ["create", "read"],
    });
  });

  it("clones statements without sharing action arrays", () => {
    const original = { interview: ["read"] };
    const cloned = clonePermissionStatements(original);
    cloned.interview?.push("create");
    expect(original.interview).toEqual(["read"]);
  });
});
