// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumePoolUploadConfirmDialog } from "./resume-pool-upload-confirm-dialog";
import type { ResumePoolUploadConfirmConfig } from "./resume-pool-upload-confirm-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function renderDialog(
  scope: "private" | "public",
  onConfirmed: (config: ResumePoolUploadConfirmConfig) => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ResumePoolUploadConfirmDialog
        fileCount={1}
        onConfirmed={onConfirmed}
        onOpenChange={vi.fn()}
        open={true}
        scope={scope}
      />,
    );
  });
  return root;
}

async function selectRecruitmentSource(label: string) {
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>('[aria-label="选择简历来源"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (candidate) => candidate.textContent === label,
    );
    option?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    option?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    option?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function clickStartUpload() {
  const startButton = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("开始上传"),
  );
  act(() => {
    startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return startButton;
}

describe("ResumePoolUploadConfirmDialog", () => {
  it.each([
    ["public", "create"],
    ["private", "skip"],
  ] as const)(
    "requires and submits a recruitment source for %s uploads",
    async (scope, dedupPolicy) => {
      const onConfirmed = vi.fn<(config: ResumePoolUploadConfirmConfig) => void>();
      const root = renderDialog(scope, onConfirmed);

      const startButton = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("开始上传"),
      );
      expect(startButton?.disabled).toBe(true);

      await selectRecruitmentSource("Boss直聘");
      clickStartUpload();

      expect(onConfirmed).toHaveBeenCalledWith({
        dedupPolicy,
        recruitmentSource: "boss",
        recruitmentSourceDetail: null,
      });

      act(() => root.unmount());
    },
  );

  it.each([
    ["内推", "referral", "李推荐"],
    ["其他", "other", "线下招聘会"],
  ] as const)("requires and submits details for the %s source", async (label, source, detail) => {
    const onConfirmed = vi.fn<(config: ResumePoolUploadConfirmConfig) => void>();
    const root = renderDialog("public", onConfirmed);

    await selectRecruitmentSource(label);
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="选择简历来源"]')?.textContent,
    ).toContain(label);
    const detailInput = document.querySelector<HTMLInputElement>(
      "#resume-pool-upload-source-detail",
    );
    expect(detailInput).toBeTruthy();
    expect(clickStartUpload()?.disabled).toBe(true);

    act(() => {
      if (detailInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(detailInput, detail);
        detailInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    clickStartUpload();

    expect(onConfirmed).toHaveBeenCalledWith({
      dedupPolicy: "create",
      recruitmentSource: source,
      recruitmentSourceDetail: detail,
    });

    act(() => root.unmount());
  });
});
