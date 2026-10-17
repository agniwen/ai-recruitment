import { describe, expect, it } from "vitest";
import { decideSscMemberRole } from "./ssc-provisioning-policy";

describe("SSC workspace membership provisioning", () => {
  const input = {
    allowExistingRoleUpdate: true,
    banned: false,
    desiredRole: "ssc-role",
    existingRole: null as string | null,
  };

  it("creates membership only for a matched eligible user", () => {
    expect(decideSscMemberRole(input)).toBe("created");
  });

  it("lets an explicit administrator save change an ordinary workspace role", () => {
    expect(decideSscMemberRole({ ...input, existingRole: "old-odc" })).toBe("updated");
  });

  it("does not overwrite a manually changed role on later sign-in", () => {
    expect(
      decideSscMemberRole({ ...input, allowExistingRoleUpdate: false, existingRole: "other-role" }),
    ).toBe("role_conflict");
  });

  it.each(["owner", "admin", "admin,another-role"])(
    "preserves privileged role %s",
    (existingRole) => {
      expect(decideSscMemberRole({ ...input, existingRole })).toBe("administrator_preserved");
    },
  );

  it("does not resurrect a noAccess member", () => {
    expect(decideSscMemberRole({ ...input, existingRole: "noAccess" })).toBe("role_conflict");
  });

  it("never grants membership to a banned user", () => {
    expect(decideSscMemberRole({ ...input, banned: true })).toBe("banned");
  });

  it("leaves an existing matching SSC role unchanged", () => {
    expect(decideSscMemberRole({ ...input, existingRole: "ssc-role" })).toBe("unchanged");
  });
});
