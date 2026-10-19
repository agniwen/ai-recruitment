import { describe, expect, it } from "vitest";
import {
  attemptsDynamicRoleIdentifierUpdate,
  hasConflictingRoleClassifications,
} from "./auth-role-policy";

describe("dynamic role update policy", () => {
  it("rejects attempts to rename an existing role identifier", () => {
    expect(
      attemptsDynamicRoleIdentifierUpdate("/organization/update-role", {
        data: { roleName: "renamed-odc" },
        roleId: "role-id",
      }),
    ).toBe(true);
  });

  it("allows display name, permission, and ODC marker updates", () => {
    expect(
      attemptsDynamicRoleIdentifierUpdate("/organization/update-role", {
        data: { isOdc: true, name: "ODC 招聘", permission: { interview: ["read"] } },
        roleId: "role-id",
      }),
    ).toBe(false);
  });

  it("does not affect unrelated auth endpoints", () => {
    expect(
      attemptsDynamicRoleIdentifierUpdate("/organization/create-role", {
        data: { roleName: "odc" },
      }),
    ).toBe(false);
  });
});

describe("dynamic role classifications", () => {
  it.each([
    [{ isOdc: true, isSsc: true }, {}, true],
    [{ isSsc: true }, { isOdc: true, isSsc: false }, true],
    [{ isOdc: true }, { isOdc: false, isSsc: true }, true],
    [{ isOdc: false, isSsc: true }, { isOdc: true, isSsc: false }, false],
    [{ isOdc: true, isSsc: false }, { isOdc: false, isSsc: true }, false],
    [{ name: "Renamed" }, { isOdc: false, isSsc: true }, false],
    [{ isOdc: false, isSsc: false }, {}, false],
  ])("checks the merged classification flags for %j", (patch, current, expected) => {
    expect(hasConflictingRoleClassifications(patch, current)).toBe(expected);
  });
});
