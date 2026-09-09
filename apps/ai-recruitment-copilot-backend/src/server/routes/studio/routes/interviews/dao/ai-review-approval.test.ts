import { beforeEach, expect, it, vi } from "vitest";
import { canApproveCandidateAiReview } from "./ai-review-approval";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), select: vi.fn(), snapshot: vi.fn() }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-permission-snapshot", () => ({
  computeWorkspacePermissionSnapshot: mocks.snapshot,
}));
beforeEach(() => {
  vi.clearAllMocks();
  const query = { from: vi.fn(), limit: mocks.limit, where: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
});

it.each(["admin", "owner", "ai-reviewer"])(
  "allows %s with role approval permission without any source assignment",
  async (role) => {
    mocks.limit.mockResolvedValue([{ role }]);
    mocks.snapshot.mockResolvedValue({ role, statements: { aiReview: ["read", "approve"] } });
    expect(await canApproveCandidateAiReview({ organizationId: "org", userId: "user" })).toBe(true);
    expect(mocks.snapshot).toHaveBeenCalledWith({
      memberRole: role,
      organizationId: "org",
      userId: "user",
    });
    expect(mocks.select).toHaveBeenCalledOnce();
  },
);

it("rejects an ODC with read permission only, regardless of old source grants", async () => {
  mocks.limit.mockResolvedValue([{ role: "odc" }]);
  mocks.snapshot.mockResolvedValue({ role: "odc", statements: { aiReview: ["read"] } });
  expect(await canApproveCandidateAiReview({ organizationId: "org", userId: "user" })).toBe(false);
});

it.each([{ rows: [] }, { rows: [{ role: "noAccess" }] }])(
  "rejects missing workspace membership or no-access membership (%j)",
  async ({ rows }) => {
    mocks.limit.mockResolvedValue(rows);
    expect(await canApproveCandidateAiReview({ organizationId: "org", userId: "user" })).toBe(
      false,
    );
    expect(mocks.snapshot).not.toHaveBeenCalled();
  },
);

it("rejects an anonymous caller", async () => {
  expect(await canApproveCandidateAiReview({ organizationId: "org", userId: null })).toBe(false);
  expect(mocks.select).not.toHaveBeenCalled();
});
