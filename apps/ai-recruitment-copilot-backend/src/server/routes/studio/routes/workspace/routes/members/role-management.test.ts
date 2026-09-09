import { describe, expect, it, vi } from "vitest";
import { member } from "@arc/db-schema/schema";
import { manageWorkspaceMember, memberManagementError } from "./role-management";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { transaction: mocks.transaction },
}));
describe("workspace administrator ownership policy", () => {
  it.each(["admin", "owner"])("allows %s to manage all role types", (actorRole) => {
    for (const targetRole of ["admin", "owner", "member"]) {
      expect(
        memberManagementError({ actorRole, nextRole: "admin", ownerCount: 2, targetRole }),
      ).toBeNull();
      expect(
        memberManagementError({ actorRole, nextRole: "owner", ownerCount: 1, targetRole }),
      ).toBeNull();
    }
  });
  it.each(["member", "noAccess", "custom", undefined])(
    "rejects non-administrator %s",
    (actorRole) => {
      expect(
        memberManagementError({
          actorRole,
          nextRole: "owner",
          ownerCount: 1,
          targetRole: "member",
        }),
      ).not.toBeNull();
    },
  );
  it.each([null, "admin", "member"])("protects the last owner from %s", (nextRole) => {
    expect(
      memberManagementError({ actorRole: "admin", nextRole, ownerCount: 1, targetRole: "owner" }),
    ).toContain("先转移");
  });
  it("rejects a missing member", () => {
    expect(
      memberManagementError({
        actorRole: "admin",
        nextRole: "owner",
        ownerCount: 1,
        targetRole: undefined,
      }),
    ).toBe("成员不存在。");
  });
});

function transactionWithMembers(rows: { id: string; userId: string; role: string }[]) {
  const write = vi.fn().mockResolvedValue(null);
  const set = vi.fn(() => ({ where: write }));
  const lock = vi.fn();
  const tx = {
    delete: () => ({ where: write }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          for: (mode: string) => {
            lock(mode);
            return Promise.resolve(table === member ? rows : [{ id: "org" }]);
          },
        }),
      }),
    }),
    update: () => ({ set }),
  };
  mocks.transaction.mockImplementation(async (operation) => await operation(tx));
  return { lock, set, write };
}
it("transfers ownership atomically from existing owners to the selected member", async () => {
  const { lock, set } = transactionWithMembers([
    { id: "a", role: "admin", userId: "actor" },
    { id: "o", role: "owner", userId: "original" },
    { id: "t", role: "member", userId: "target" },
  ]);
  expect(
    await manageWorkspaceMember({
      actorId: "actor",
      memberId: "t",
      organizationId: "org",
      role: "owner",
    }),
  ).toEqual({ error: null });
  expect(lock).toHaveBeenCalledWith("update");
  expect(set).toHaveBeenNthCalledWith(1, { role: "admin" });
  expect(set).toHaveBeenNthCalledWith(2, { role: "owner" });
});
it("does not modify a target outside the workspace", async () => {
  const { write } = transactionWithMembers([{ id: "a", role: "admin", userId: "actor" }]);
  expect(
    await manageWorkspaceMember({
      actorId: "actor",
      memberId: "foreign",
      organizationId: "org",
      role: "owner",
    }),
  ).toEqual({ error: "成员不存在。" });
  expect(write).not.toHaveBeenCalled();
});
it("rechecks the actor role in the transaction before changing membership", async () => {
  const { write } = transactionWithMembers([
    { id: "a", role: "member", userId: "actor" },
    { id: "t", role: "admin", userId: "target" },
  ]);
  const result = await manageWorkspaceMember({
    actorId: "actor",
    memberId: "t",
    organizationId: "org",
    role: null,
  });
  expect(result.error).toContain("只有管理员");
  expect(write).not.toHaveBeenCalled();
});
