import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import { listSelectableResumeSources } from "./resume-source";
const mocks = vi.hoisted(() => ({
  orderBy: vi.fn(),
  scope: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
}));
vi.mock("../../utils/hiring-unit-scope", () => ({ resolveHiringUnitAccessScope: mocks.scope }));
vi.mock("@arc/ai-recruitment-copilot-backend/lib/server/db", () => ({
  db: { select: mocks.select },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.orderBy.mockResolvedValue([{ id: "source-a", name: "来源" }]);
});
it("returns only id/name options scoped to the current workspace and assigned sources", async () => {
  mocks.scope.mockResolvedValue({ canAccessAll: false, resumeSourceIds: ["source-a"] });
  await listSelectableResumeSources({ actorUserId: "odc", organizationId: "work" });
  expect(Object.keys(mocks.select.mock.calls[0][0])).toEqual(["id", "name"]);
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(query.params).toEqual(["work", "source-a"]);
});
it("returns no options when the actor has no source scope", async () => {
  mocks.scope.mockResolvedValue({ canAccessAll: false, resumeSourceIds: [] });
  expect(await listSelectableResumeSources({ actorUserId: "odc", organizationId: "work" })).toEqual(
    [],
  );
  expect(mocks.select).not.toHaveBeenCalled();
});
it("still scopes administrators to the current workspace", async () => {
  mocks.scope.mockResolvedValue({ canAccessAll: true });
  await listSelectableResumeSources({ actorUserId: "admin", organizationId: "work" });
  expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual(["work"]);
});
