import { describe, expect, it } from "vitest";
import { attemptsDynamicRoleIdentifierUpdate } from "./auth-role-policy";

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
