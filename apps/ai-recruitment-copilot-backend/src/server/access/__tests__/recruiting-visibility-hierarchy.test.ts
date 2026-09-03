import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn<() => unknown>(),
}));

vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));

// oxlint-disable-next-line import/first -- must follow vi.mock() for correct hoisting.
import { resolveRecruitingVisibilityScope } from "../recruiting-visibility";

function queueSelectResults(results: unknown[][]) {
  const queue = [...results];
  mocks.select.mockImplementation(
    () =>
      ({
        from: () => ({
          where: () => Promise.resolve(queue.shift() ?? []),
        }),
      }) as never,
  );
}

describe("direct-manager recruiting visibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recursively inherits each direct report's recruiting-group visibility", async () => {
    queueSelectResults([
      [
        { directManagerId: null, id: "top-member", role: "member", userId: "top" },
        {
          directManagerId: "top-member",
          id: "middle-member",
          role: "member",
          userId: "middle",
        },
        {
          directManagerId: "middle-member",
          id: "lead-member",
          role: "member",
          userId: "lead",
        },
        { directManagerId: null, id: "hr-a-member", role: "member", userId: "hr-a" },
        { directManagerId: null, id: "hr-b-member", role: "member", userId: "hr-b" },
        { directManagerId: null, id: "peer-member", role: "member", userId: "peer" },
      ],
      [
        { groupId: "group-a", role: "recruitingSupervisor", userId: "middle" },
        { groupId: "group-b", role: "recruitingLead", userId: "lead" },
      ],
      [
        { groupId: "group-a", role: "hr", userId: "hr-a" },
        { groupId: "group-a", role: "recruitingSupervisor", userId: "peer" },
        { groupId: "group-b", role: "hr", userId: "hr-b" },
      ],
    ]);

    const scope = await resolveRecruitingVisibilityScope({
      organizationId: "workspace",
      userId: "top",
    });

    expect(scope).toEqual({
      kind: "restricted",
      userIds: expect.arrayContaining(["top", "middle", "lead", "hr-a", "hr-b"]),
    });
    expect(scope.kind === "restricted" ? scope.userIds : []).not.toContain("peer");
  });
});
