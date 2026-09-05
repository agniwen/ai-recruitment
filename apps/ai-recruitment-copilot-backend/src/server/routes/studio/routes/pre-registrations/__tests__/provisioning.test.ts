import { describe, expect, it, vi } from "vitest";
import {
  buildPreRegistrationProfileUpdate,
  buildProspectiveManagerRelationships,
  buildReconciledReportingLines,
  buildRegisteredReportingLines,
  hasMemberReportingLineCycle,
  hasPreRegistrationManagerCycle,
  provisionPreRegisteredUser,
} from "../provisioning";

describe("pre-registration profile and hierarchy", () => {
  it("uses the flower name and TG as the registered user profile", () => {
    expect(buildPreRegistrationProfileUpdate({ displayName: "张三", telegram: "@member" })).toEqual(
      { name: "张三", telegram: "@member" },
    );
  });

  it("links a registered child when its manager registers later", () => {
    const childOnly = buildRegisteredReportingLines(
      [{ directManagerEmail: "manager@example.com", email: "child@example.com" }],
      [{ email: "child@example.com", memberId: "child-member" }],
      "work-org",
    );
    expect(childOnly.reportingLines).toEqual([]);

    const afterManagerRegisters = buildRegisteredReportingLines(
      [
        {
          directManagerEmail: "MANAGER@example.com",
          email: "child@example.com",
        },
      ],
      [
        { email: "child@example.com", memberId: "child-member" },
        { email: "manager@example.com", memberId: "manager-member" },
      ],
      "work-org",
    );
    expect(afterManagerRegisters.reportingLines).toEqual([
      {
        directManagerId: "manager-member",
        memberId: "child-member",
        organizationId: "work-org",
      },
    ]);
  });

  it("links a newly registered child when its manager is already registered", () => {
    const result = buildRegisteredReportingLines(
      [
        {
          directManagerEmail: "manager@example.com",
          email: "child@example.com",
        },
      ],
      [
        { email: "manager@example.com", memberId: "manager-member" },
        { email: "child@example.com", memberId: "child-member" },
      ],
      "work-org",
    );
    expect(result.reportingLines[0]).toMatchObject({
      directManagerId: "manager-member",
      memberId: "child-member",
    });
  });

  it("rejects a deferred relationship that conflicts with an existing inverse edge", () => {
    const reconciled = buildReconciledReportingLines(
      [{ directManagerId: "a-member", memberId: "b-member" }],
      ["a-member"],
      [{ directManagerId: "b-member", memberId: "a-member" }],
    );

    expect(hasMemberReportingLineCycle(reconciled)).toBe(true);
  });
});

describe("provisionPreRegisteredUser", () => {
  it("applies every workspace pre-entry with its own role, and scopes edits to one workspace", async () => {
    const records = ["alpha", "beta"].map((workspaceSlug) => ({
      directManagerEmail: null,
      displayName: "张三",
      email: "person@example.com",
      id: workspaceSlug,
      recruitingGroupNames: ["招聘组"],
      recruitingRole: "hr" as const,
      telegram: "@person",
      workspaceRole: `${workspaceSlug}-hr`,
      workspaceSlug,
    }));
    const dependencies = {
      applyRegistration: vi.fn(),
      findRegistrationsByEmail: vi.fn().mockResolvedValue(records),
      reconcileWorkspaceReportingLines: vi.fn(),
    };
    await provisionPreRegisteredUser({ email: "person@example.com", userId: "u" }, dependencies);
    expect(dependencies.applyRegistration).toHaveBeenNthCalledWith(1, records[0], "u");
    expect(dependencies.applyRegistration).toHaveBeenNthCalledWith(2, records[1], "u");
    dependencies.applyRegistration.mockClear();
    dependencies.reconcileWorkspaceReportingLines.mockClear();
    await provisionPreRegisteredUser(
      { email: "person@example.com", userId: "u", workspaceSlug: "beta" },
      dependencies,
    );
    expect(dependencies.applyRegistration).toHaveBeenCalledExactlyOnceWith(records[1], "u");
    expect(dependencies.reconcileWorkspaceReportingLines).toHaveBeenCalledExactlyOnceWith("beta");
  });
  it("does nothing when the registration email is not pre-entered", async () => {
    const dependencies = {
      applyRegistration: vi.fn(),
      findRegistrationsByEmail: vi.fn().mockResolvedValue([]),
      reconcileWorkspaceReportingLines: vi.fn(),
    };

    await expect(
      provisionPreRegisteredUser({ email: "new@example.com", userId: "user-1" }, dependencies),
    ).resolves.toBe("unmatched");
    expect(dependencies.applyRegistration).not.toHaveBeenCalled();
  });

  it("applies the pre-entry and reconciles deferred manager relationships", async () => {
    const registration = {
      directManagerEmail: "manager@example.com",
      displayName: "张三",
      email: "member@example.com",
      id: "entry-1",
      recruitingGroupNames: ["燎原社"],
      recruitingRole: "hr" as const,
      telegram: "@member",
      workspaceRole: "custom-hr",
      workspaceSlug: "work",
    };
    const dependencies = {
      applyRegistration: vi.fn(() => Promise.resolve()),
      findRegistrationsByEmail: vi.fn().mockResolvedValue([registration]),
      reconcileWorkspaceReportingLines: vi.fn(() => Promise.resolve()),
    };

    await expect(
      provisionPreRegisteredUser({ email: " MEMBER@example.com ", userId: "user-1" }, dependencies),
    ).resolves.toBe("applied");
    expect(dependencies.findRegistrationsByEmail).toHaveBeenCalledWith("member@example.com");
    expect(dependencies.applyRegistration).toHaveBeenCalledWith(registration, "user-1");
    expect(dependencies.reconcileWorkspaceReportingLines).toHaveBeenCalledWith("work");
  });
});

describe("hasPreRegistrationManagerCycle", () => {
  it("detects direct and indirect manager cycles", () => {
    expect(
      hasPreRegistrationManagerCycle([
        { directManagerEmail: "b@example.com", email: "a@example.com" },
        { directManagerEmail: "a@example.com", email: "b@example.com" },
      ]),
    ).toBe(true);
    expect(
      hasPreRegistrationManagerCycle([
        { directManagerEmail: null, email: "a@example.com" },
        { directManagerEmail: "a@example.com", email: "b@example.com" },
        { directManagerEmail: "b@example.com", email: "c@example.com" },
      ]),
    ).toBe(false);
  });

  it("detects cycles that include an existing registered-member relationship", () => {
    const relationships = buildProspectiveManagerRelationships({
      current: {
        directManagerEmail: "registered@example.com",
        email: "pre-entry@example.com",
        id: "pre-entry",
      },
      memberRelationships: [
        {
          directManagerEmail: "pre-entry@example.com",
          email: "registered@example.com",
        },
      ],
      preRegistrations: [],
      previousEmail: null,
    });

    expect(hasPreRegistrationManagerCycle(relationships)).toBe(true);
  });

  it("preserves subordinates on the old email when that identity is already registered", () => {
    const relationships = buildProspectiveManagerRelationships({
      current: {
        directManagerEmail: null,
        email: "new@example.com",
        id: "manager",
      },
      memberRelationships: [],
      preRegistrations: [
        { directManagerEmail: null, email: "old@example.com", id: "manager" },
        { directManagerEmail: "old@example.com", email: "child@example.com", id: "child" },
      ],
      previousEmail: null,
    });

    expect(relationships).toContainEqual({
      directManagerEmail: "old@example.com",
      email: "child@example.com",
    });
  });
});
