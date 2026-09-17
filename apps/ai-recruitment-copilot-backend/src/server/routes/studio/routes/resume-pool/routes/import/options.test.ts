import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadResumePoolImportOptions } from "./options";

const mocks = vi.hoisted(() => ({ jobs: vi.fn(), rows: vi.fn(), scope: vi.fn() }));
vi.mock("../../../job-descriptions/dao", () => ({ listAllJobDescriptions: mocks.jobs }));
vi.mock("../../../../utils/hiring-unit-scope", () => ({
  resolveHiringUnitAccessScope: mocks.scope,
}));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: mocks.rows }) }) }) },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue({ canAccessAll: false, hiringUnitIds: ["scoped"] });
  mocks.jobs.mockResolvedValue([{ hiringUnitId: "actual", id: "allowed", name: "APP中级运营" }]);
  mocks.rows
    .mockResolvedValueOnce([
      { id: "scoped", name: "运营中心" },
      { id: "actual", name: "运营中心" },
    ])
    .mockResolvedValueOnce([]);
});

describe("import options for source-authorized jobs", () => {
  it("keeps the authorized job's actual unit without granting unbound import access", async () => {
    const options = await loadResumePoolImportOptions("org", "actor");
    expect(mocks.jobs).toHaveBeenCalledWith("org", { actorUserId: "actor" });
    expect(options.jobDescriptions.map((job) => job.id)).toEqual(["allowed"]);
    expect(options.hiringUnits).toEqual([
      { canImportWithoutJob: true, id: "scoped", name: "运营中心" },
      { canImportWithoutJob: false, id: "actual", name: "运营中心" },
    ]);
  });
  it("retains unrestricted organization access for administrators", async () => {
    mocks.scope.mockResolvedValue({ canAccessAll: true, hiringUnitIds: [] });
    const options = await loadResumePoolImportOptions("org", "admin");
    expect(options.hiringUnits.every((unit) => unit.canImportWithoutJob)).toBe(true);
  });
});
