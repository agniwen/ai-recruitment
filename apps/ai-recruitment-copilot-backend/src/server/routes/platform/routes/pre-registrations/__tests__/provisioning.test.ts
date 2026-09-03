import { describe, expect, it, vi } from "vitest";
import { hasPreRegistrationManagerCycle, provisionPreRegisteredUser } from "../provisioning";

describe("provisionPreRegisteredUser", () => {
  it("does nothing when the registration email is not pre-entered", async () => {
    const dependencies = {
      applyRegistration: vi.fn(),
      findRegistrationByEmail: vi.fn().mockResolvedValue(null),
      reconcileWorkspaceReportingLines: vi.fn(),
    };

    await expect(
      provisionPreRegisteredUser({ email: "new@example.com", userId: "user-1" }, dependencies),
    ).resolves.toBe("unmatched");
    expect(dependencies.applyRegistration).not.toHaveBeenCalled();
  });

  it("applies the pre-entry and reconciles deferred manager relationships", async () => {
    const registration = {
      directManagerId: "manager-entry",
      displayName: "张三",
      email: "member@example.com",
      id: "entry-1",
      recruitingGroupNames: ["燎原社"],
      recruitingRole: "hr" as const,
      telegram: "@member",
      workspaceSlug: "work",
    };
    const dependencies = {
      applyRegistration: vi.fn(() => Promise.resolve()),
      findRegistrationByEmail: vi.fn().mockResolvedValue(registration),
      reconcileWorkspaceReportingLines: vi.fn(() => Promise.resolve()),
    };

    await expect(
      provisionPreRegisteredUser({ email: " MEMBER@example.com ", userId: "user-1" }, dependencies),
    ).resolves.toBe("applied");
    expect(dependencies.findRegistrationByEmail).toHaveBeenCalledWith("member@example.com");
    expect(dependencies.applyRegistration).toHaveBeenCalledWith(registration, "user-1");
    expect(dependencies.reconcileWorkspaceReportingLines).toHaveBeenCalledWith("work");
  });
});

describe("hasPreRegistrationManagerCycle", () => {
  it("detects direct and indirect manager cycles", () => {
    expect(
      hasPreRegistrationManagerCycle([
        { directManagerId: "b", id: "a" },
        { directManagerId: "a", id: "b" },
      ]),
    ).toBe(true);
    expect(
      hasPreRegistrationManagerCycle([
        { directManagerId: null, id: "a" },
        { directManagerId: "a", id: "b" },
        { directManagerId: "b", id: "c" },
      ]),
    ).toBe(false);
  });
});
