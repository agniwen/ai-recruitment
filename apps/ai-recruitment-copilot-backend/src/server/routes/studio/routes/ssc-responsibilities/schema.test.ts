import { describe, expect, it } from "vitest";
import { sscResponsibilityInputSchema } from "./schema";

const input = {
  centerName: "Center",
  demandOwner: "",
  email: "",
  notes: "",
  resumeSourceId: "source-a",
  sscName: "",
  telegram: "",
  workspaceRole: "ssc-role",
};

describe("SSC organization assignment input", () => {
  it("retains the chosen source and SSC role keys while normalizing input", () => {
    expect(
      sscResponsibilityInputSchema.parse({
        ...input,
        email: " PERSON@EXAMPLE.COM ",
        resumeSourceId: " source-a ",
        workspaceRole: " ssc-role ",
      }),
    ).toEqual({ ...input, email: "person@example.com" });
  });

  it("allows an explicit unlinked source for legacy-row validation", () => {
    expect(sscResponsibilityInputSchema.parse({ ...input, resumeSourceId: null })).toEqual({
      ...input,
      resumeSourceId: null,
    });
  });

  it.each([
    { resumeSourceId: undefined },
    { resumeSourceId: " " },
    { workspaceRole: undefined },
    { workspaceRole: null },
    { workspaceRole: " " },
    { workspaceRole: "first,second" },
  ])("rejects invalid role or source input %j", (patch) => {
    expect(sscResponsibilityInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
