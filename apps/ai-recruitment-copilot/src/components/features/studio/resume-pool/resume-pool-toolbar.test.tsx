// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ResumePoolToolbarActions } from "./resume-pool-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./resume-pool-details", () => ({ ResumePoolCard: () => null }));
vi.mock("./resume-pool-page-model", () => ({
  canDeletePoolRecord: vi.fn(),
  canManagePoolRecord: vi.fn(),
}));

describe("resume pool bulk retry button", () => {
  it("honors permission and disables repeated clicks while submitting", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const retry = vi.fn();
    const props = {
      canOpenBatchList: false,
      canUpload: false,
      hasActiveUploadBatches: false,
      hasSelectedPrivateResumes: false,
      isBulkDeleting: false,
      isDeletingPoolRecords: false,
      onBulkDelete: vi.fn(),
      onOpenBatchList: vi.fn(),
      onRetryFailed: retry,
      onUpload: vi.fn(),
      selectedCount: 0,
    };
    act(() => root.render(<ResumePoolToolbarActions {...props} canRetryFailed={false} />));
    expect(container.textContent).not.toContain("一键重试失败");
    act(() => root.render(<ResumePoolToolbarActions {...props} canRetryFailed />));
    expect(container.textContent).toContain("一键重试失败");
    act(() => container.querySelector("button")?.click());
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => root.render(<ResumePoolToolbarActions {...props} canRetryFailed retryingFailed />));
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.textContent).toContain("正在加入队列");
    act(() => container.querySelector("button")?.click());
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
