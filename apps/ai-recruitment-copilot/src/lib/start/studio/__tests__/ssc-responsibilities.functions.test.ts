import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataGridQueryState } from "@/components/data-grid/query-contract";
import type { WorkspaceAccessState } from "@/lib/start/auth-session-types";
import { loadStudioSscResponsibilitiesState } from "../ssc-responsibilities.functions";

const mocks = vi.hoisted(() => ({
  administrator: vi.fn(),
  list: vi.fn(),
  resolveAccess: vi.fn(),
}));

// Exercise the registered handler without the server-function transport.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (handler: (context: { data: unknown }) => unknown) => handler,
    }),
  }),
}));
vi.mock("../page-access.server", () => ({
  resolveAuthorizedStudioPageAccessFromRequest: mocks.resolveAccess,
}));
vi.mock(
  "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/ssc-responsibilities/dao",
  () => ({
    loadSscResponsibilityAdministrator: mocks.administrator,
    queryPaginatedSscResponsibilities: mocks.list,
  }),
);

const query: DataGridQueryState<Record<string, never>> = {
  filters: {},
  page: 2,
  pageSize: 20,
  search: "%_team",
  sortBy: "email",
  sortOrder: "desc",
};

function readyAccess(role: string): Extract<WorkspaceAccessState, { status: "ready" }> {
  return {
    member: { role },
    permissions: { page: ["sscResponsibilities"] },
    status: "ready",
    user: { id: "user-1" },
    workspace: { id: "actual-org-id", slug: "work" },
  };
}

function loadState() {
  return loadStudioSscResponsibilitiesState({ data: { query, slug: "work" } });
}

describe("SSC responsibility server loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAccess.mockResolvedValue(readyAccess("admin"));
    mocks.administrator.mockResolvedValue({ role: "admin" });
    mocks.list.mockResolvedValue({ page: 2, pageSize: 20, records: [], total: 0, totalPages: 0 });
  });

  it.each(["member", "custom-ssc"])(
    "denies %s even when its page permission is granted",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue(readyAccess(role));

      await expect(loadState()).resolves.toEqual({ status: "not_found" });
      expect(mocks.administrator).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it("denies a stale administrator snapshot when current membership no longer permits access", async () => {
    mocks.administrator.mockResolvedValue(null);

    await expect(loadState()).resolves.toEqual({ status: "not_found" });
    expect(mocks.administrator).toHaveBeenCalledWith("actual-org-id", "user-1");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])(
    "hydrates %s using the real organization ID and the grid query key",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue(readyAccess(role));
      mocks.administrator.mockResolvedValue({ role });

      const state = await loadState();

      expect(mocks.resolveAccess).toHaveBeenCalledWith("work", "sscResponsibilities");
      expect(mocks.administrator).toHaveBeenCalledWith("actual-org-id", "user-1");
      expect(mocks.list).toHaveBeenCalledWith("actual-org-id", {
        page: 2,
        pageSize: 20,
        search: "%_team",
        sortBy: "email",
        sortOrder: "desc",
      });
      expect(state).toMatchObject({
        dehydratedState: {
          queries: [
            {
              queryKey: [
                "studio-ssc-responsibilities",
                "work",
                { ...query, filters: { textFilters: "" } },
              ],
            },
          ],
        },
        status: "ready",
      });
    },
  );

  it.each([{ status: "unauthenticated" }, { status: "not_found" }] as const)(
    "preserves $status without reading responsibilities",
    async (access) => {
      mocks.resolveAccess.mockResolvedValue(access);

      await expect(loadState()).resolves.toEqual(access);
      expect(mocks.administrator).not.toHaveBeenCalled();
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );
});
