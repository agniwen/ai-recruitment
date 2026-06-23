import { describe, expect, it } from "vitest";
import { resumePoolImportSchema } from "../resume-pool";

describe("resumePoolImportSchema", () => {
  it("requires a hiring unit before importing into the resume library", () => {
    const result = resumePoolImportSchema.safeParse({
      dedupPolicy: "check",
      jobDescriptionMode: "none",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("请选择入库组织");
    }
  });
});
