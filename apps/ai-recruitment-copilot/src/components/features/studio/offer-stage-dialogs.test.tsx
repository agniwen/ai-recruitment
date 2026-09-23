// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateOrEditOfferDialog } from "./offer-stage-dialogs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "demo" }));

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function renderDialog() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateOrEditOfferDialog
          candidateEmail={null}
          candidateId="candidate-1"
          mode="create"
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
          open={true}
        />
      </QueryClientProvider>,
    );
  });
  return document.body.querySelector<HTMLInputElement>("#offer-approval-attachment");
}

describe("new Offer attachment", () => {
  it("opens a selected image in a modal only after View and removes it before saving", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:ssc-preview");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const input = renderDialog();
    expect(input).not.toBeNull();
    const image = new File(["image"], "ssc.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [image] });

    act(() => input?.dispatchEvent(new Event("change", { bubbles: true })));

    expect(createObjectURL).toHaveBeenCalledWith(image);
    expect(document.body.querySelector('img[alt="待上传附件预览：ssc.png"]')).toBeNull();
    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-label="附件操作：ssc.png"]')
        ?.click();
    });
    act(() => {
      [...document.body.querySelectorAll('[data-slot="hover-card-content"] button')]
        .find((button) => button.textContent?.trim() === "查看")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const preview = document.body.querySelector('img[alt="待上传附件预览：ssc.png"]');
    expect(preview?.closest('[role="dialog"]')).not.toBeNull();
    expect(
      document.body.querySelector<HTMLImageElement>('img[alt="待上传附件预览：ssc.png"]')?.src,
    ).toBe("blob:ssc-preview");

    act(() => {
      preview
        ?.closest('[role="dialog"]')
        ?.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
        ?.click();
    });

    act(() => {
      document.body
        .querySelector<HTMLButtonElement>('button[aria-label="移除附件 ssc.png"]')
        ?.click();
    });

    expect(document.body.querySelector('img[alt="待上传附件预览：ssc.png"]')).toBeNull();
    expect(document.body.textContent).not.toContain("已选择：ssc.png");
    expect(input?.value).toBe("");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ssc-preview");
  });
});
