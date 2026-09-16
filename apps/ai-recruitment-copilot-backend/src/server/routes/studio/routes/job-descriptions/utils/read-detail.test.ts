import { beforeEach, expect, it, vi } from "vitest";
import { loadJobDescriptionForReader } from "./read-detail";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  load: vi.fn(),
  pending: vi.fn(),
  where: vi.fn(),
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.where }) }) },
}));
vi.mock("@arc/ai-recruitment-copilot-backend/server/access/workspace-access-policy", () => ({
  createRequestWorkspaceAuthorizer: () => mocks.authorize,
}));
vi.mock("../dao", () => ({ loadJobDescriptionById: mocks.load }));
const input = {
  jobDescriptionId: "jd",
  memberRole: "reviewer",
  organizationId: "org",
  userId: "user",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorize.mockResolvedValue(false);
  mocks.load.mockResolvedValue(null);
  mocks.pending.mockResolvedValue([]);
  mocks.where.mockReturnValue({ limit: mocks.pending });
});
it("preserves normal source-scoped job read access", async () => {
  mocks.authorize.mockImplementation(({ resource }) => Promise.resolve(resource === "jd"));
  mocks.load.mockResolvedValue({ id: "jd" });
  expect(await loadJobDescriptionForReader(input)).toEqual({ id: "jd" });
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith("org", "jd", { actorUserId: "user" });
  expect(mocks.pending).not.toHaveBeenCalled();
});
it("allows an approver without jd read to see a pending candidate's job", async () => {
  mocks.authorize.mockImplementation(({ resource }) => Promise.resolve(resource === "aiReview"));
  mocks.pending.mockResolvedValue([{ id: "candidate" }]);
  mocks.load.mockResolvedValue({ id: "jd" });
  expect(await loadJobDescriptionForReader(input)).toEqual({ id: "jd" });
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith("org", "jd");
});
it("allows an approver to read a job outside their ordinary source scope", async () => {
  mocks.authorize.mockResolvedValue(true);
  mocks.pending.mockResolvedValue([{ id: "candidate" }]);
  mocks.load.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "jd" });
  expect(await loadJobDescriptionForReader(input)).toEqual({ id: "jd" });
  expect(mocks.load).toHaveBeenNthCalledWith(2, "org", "jd");
});
it("denies an out-of-scope job without approval permission", async () => {
  mocks.authorize.mockImplementation(({ resource }) => Promise.resolve(resource === "jd"));
  expect(await loadJobDescriptionForReader(input)).toBeNull();
  expect(mocks.pending).not.toHaveBeenCalled();
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
it("does not grant approval access when no candidate remains in review", async () => {
  mocks.authorize.mockResolvedValue(true);
  expect(await loadJobDescriptionForReader(input)).toBeNull();
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
it("rejects anonymous reads", async () => {
  expect(await loadJobDescriptionForReader({ ...input, userId: null })).toBeNull();
  expect(mocks.authorize).not.toHaveBeenCalled();
});
