import { beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "@arc/ai-recruitment-copilot-backend/server/factory";
import { platformHistoricalResumeImportsRouter } from "../route";

const historicalResumeImportMocks = vi.hoisted(() => ({
  query: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("../dao", () => ({
  queryPaginatedHistoricalResumeImports: historicalResumeImportMocks.query,
  retryHistoricalResumeImports: historicalResumeImportMocks.retry,
}));

const app = factory
  .createApp()
  .route("/historical-resume-imports", platformHistoricalResumeImportsRouter);

describe("platform historical resume import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries only the current failed-list search scope", async () => {
    historicalResumeImportMocks.retry.mockResolvedValue({ retriedCount: 12 });

    const response = await app.request("/historical-resume-imports/retry-failed", {
      body: JSON.stringify({ search: "待重试" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ retriedCount: 12 });
    expect(historicalResumeImportMocks.retry).toHaveBeenCalledWith({ search: "待重试" });
  });

  it("validates retry input before it reaches the DAO", async () => {
    const response = await app.request("/historical-resume-imports/retry-failed", {
      body: JSON.stringify({ search: 123 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(historicalResumeImportMocks.retry).not.toHaveBeenCalled();
  });
});
