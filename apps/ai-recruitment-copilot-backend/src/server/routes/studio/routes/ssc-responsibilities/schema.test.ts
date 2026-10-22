import { describe, expect, it } from "vitest";
import {
  sscResponsibilityInputSchema,
  sscAssignmentCandidatesQuerySchema,
  sscSourceAssignmentInputSchema,
  sscResponsibilityImportSchema,
} from "./schema";

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
  it("normalizes explicit job restrictions without inventing restrictions for old clients", () => {
    expect(
      sscResponsibilityInputSchema.parse({
        ...input,
        departmentId: " department-a ",
        serviceUnit: " Sinema ",
      }),
    ).toMatchObject({ departmentId: "department-a", serviceUnit: "Sinema" });
    expect(
      sscResponsibilityInputSchema.parse({ ...input, departmentId: " ", serviceUnit: " " }),
    ).toMatchObject({ departmentId: null, serviceUnit: null });
    expect(sscResponsibilityInputSchema.parse(input)).not.toHaveProperty("serviceUnit");
    expect(
      sscResponsibilityInputSchema.safeParse({ ...input, serviceUnit: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("carries job restrictions through source assignment endpoints and legacy import rows", () => {
    const scope = {
      departmentId: "department-a",
      resumeSourceId: "source-a",
      serviceUnit: " Sinema ",
    };
    expect(sscAssignmentCandidatesQuerySchema.parse(scope)).toEqual({
      ...scope,
      serviceUnit: "Sinema",
    });
    expect(sscSourceAssignmentInputSchema.parse({ ...scope, candidateIds: ["member:a"] })).toEqual({
      ...scope,
      candidateIds: ["member:a"],
      serviceUnit: "Sinema",
    });
    const parsed = sscResponsibilityImportSchema.parse({
      rows: [{ ...input, row: 2 }],
      workspaceRole: "ssc-role",
    });
    expect(parsed.rows[0]).toMatchObject({ departmentName: "", serviceUnit: "" });
  });
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
