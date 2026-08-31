import { describe, expect, it } from "vitest";
import {
  mergeHiringUnitAccessScopes,
  mergeRecruitingVisibilityScopes,
} from "./visibility-scope-merge";

describe("ODC analysis visibility scope", () => {
  it("unions the candidate creator ids visible to every ODC member", () => {
    expect(
      mergeRecruitingVisibilityScopes([
        { kind: "restricted", userIds: ["odc-a", "hr-a"] },
        { kind: "none" },
        { kind: "restricted", userIds: ["odc-b", "hr-a"] },
      ]),
    ).toEqual({ kind: "restricted", userIds: ["odc-a", "hr-a", "odc-b"] });
  });

  it("lets an all-data ODC member widen the candidate scope to all", () => {
    expect(
      mergeRecruitingVisibilityScopes([
        { kind: "restricted", userIds: ["odc-a"] },
        { kind: "all" },
      ]),
    ).toEqual({ kind: "all" });
  });

  it("returns no candidate visibility when no ODC member can see data", () => {
    expect(mergeRecruitingVisibilityScopes([])).toEqual({ kind: "none" });
    expect(mergeRecruitingVisibilityScopes([{ kind: "none" }])).toEqual({ kind: "none" });
  });

  it("unions public and assigned hiring-unit visibility for all ODC members", () => {
    expect(
      mergeHiringUnitAccessScopes([
        { canAccessAll: false, canAccessPublic: true, hiringUnitIds: ["unit-a"] },
        { canAccessAll: false, canAccessPublic: false, hiringUnitIds: ["unit-b", "unit-a"] },
      ]),
    ).toEqual({
      canAccessAll: false,
      canAccessPublic: true,
      hiringUnitIds: ["unit-a", "unit-b"],
    });
  });

  it("returns an empty hiring-unit scope when there are no ODC members", () => {
    expect(mergeHiringUnitAccessScopes([])).toEqual({
      canAccessAll: false,
      canAccessPublic: false,
      hiringUnitIds: [],
    });
  });
});
