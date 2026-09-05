import { beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@arc/db-schema/schema";
import { provisionPreRegisteredUser } from "../provisioning";

const mocks = vi.hoisted(() => ({
  dynamicRoleExists: vi.fn(),
  inserts: [] as { table: unknown; values: unknown; conflict: string }[],
  reads: [] as unknown[][],
}));

vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-roles", () => ({
  dynamicWorkspaceRoleExists: mocks.dynamicRoleExists,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => {
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          mocks.inserts.push({ conflict: "nothing", table, values });
          return Promise.resolve();
        },
      }),
    }),
    select: () => {
      const result = Promise.resolve(mocks.reads.shift() ?? []);
      const chain = {
        from: () => chain,
        limit: () => result,
        // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
        then: result.then.bind(result),
        where: () => chain,
      };
      return chain;
    },
    transaction: (run: (tx: unknown) => Promise<unknown>) => run(db),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  return { db };
});

const registration = {
  directManagerEmail: null,
  displayName: "新人",
  email: "new@example.com",
  id: "entry",
  recruitingGroupNames: [],
  recruitingRole: "hr",
  telegram: "@new",
  workspaceRole: "custom-hr",
  workspaceSlug: "alpha",
};

describe("pre-registration membership persistence", () => {
  beforeEach(() => {
    mocks.inserts.length = 0;
    mocks.reads.length = 0;
    mocks.dynamicRoleExists.mockReset();
  });

  it("writes the selected workspace role and preserves an existing membership on conflict", async () => {
    // The last empty result skips reporting-line reconciliation in this focused test.
    mocks.reads.push([registration], [{ id: "org-alpha" }], []);
    mocks.dynamicRoleExists.mockResolvedValue(true);
    await expect(
      provisionPreRegisteredUser({ email: registration.email, userId: "u" }),
    ).resolves.toBe("applied");
    expect(mocks.dynamicRoleExists).toHaveBeenCalledWith("org-alpha", "custom-hr");
    expect(mocks.inserts).toEqual([
      {
        conflict: "nothing",
        table: member,
        values: expect.objectContaining({
          organizationId: "org-alpha",
          role: "custom-hr",
          userId: "u",
        }),
      },
    ]);
  });

  it("does not create a membership with a deleted custom role", async () => {
    mocks.reads.push([registration], [{ id: "org-alpha" }]);
    mocks.dynamicRoleExists.mockResolvedValue(false);
    await expect(
      provisionPreRegisteredUser({ email: registration.email, userId: "u" }),
    ).rejects.toThrow("workspace role no longer exists");
    expect(mocks.inserts).toEqual([]);
  });
});
