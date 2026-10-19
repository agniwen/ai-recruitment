// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UploadTaskInboxRecord } from "@arc/shared/upload-task-inbox";
import { UploadTaskRow } from "./upload-task-inbox";
import { installNoopResizeObserver } from "@/test-utils/react-act";

vi.mock("./historical-resume-import-table-dialog", () => ({
  HistoricalResumeImportTableDialog: () => null,
}));
vi.mock("@/components/features/resume/resume-document-preview-modal", () => ({
  ResumeDocumentPreviewModal: () => null,
}));
installNoopResizeObserver();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = "";
});

const record: UploadTaskInboxRecord = {
  attemptCount: 2,
  batchId: "batch",
  candidateName: null,
  errorMessage: "OCR 服务超时",
  fileSize: 100,
  finishedAt: null,
  id: "item",
  originalFileName: "简历.pdf",
  previewTarget: null,
  progressPercent: null,
  queueState: "failed",
  queuedAt: null,
  startedAt: null,
  status: "failed",
  target: "resume_library",
  targetRole: null,
};

describe("failed upload task", () => {
  it("shows the failure reason and allows retry after automatic attempts are exhausted without preview access", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const retry = vi.fn();
    const preview = vi.fn();
    act(() =>
      root.render(
        <UploadTaskRow
          record={record}
          canPreview={false}
          canRetry
          retrying={false}
          onRetry={retry}
          onPreview={preview}
        />,
      ),
    );
    expect(container.textContent).toContain("OCR 服务超时");
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "重试",
    );
    expect(button?.disabled).toBe(false);
    act(() => button?.click());
    expect(retry).toHaveBeenCalledWith(record);
    expect(preview).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
  it("hides retries without process permission and supplies a fallback reason", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <UploadTaskRow
          record={{ ...record, errorMessage: null }}
          canPreview={false}
          canRetry={false}
          retrying={false}
          onRetry={vi.fn()}
          onPreview={vi.fn()}
        />,
      ),
    );
    expect(container.textContent).toContain("简历解析失败，请重试。");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    act(() => root.unmount());
  });
});
