// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PortfolioLinkDialog } from "./portfolio-link-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
afterEach(() => document.body.replaceChildren());
function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) {
    throw new Error(`Missing button: ${text}`);
  }
  button.click();
}
function input(label: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (!element) {
    throw new Error(`Missing input: ${label}`);
  }
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
function render(onSubmit = vi.fn(), maxLinks = 10) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  act(() =>
    root.render(<PortfolioLinkDialog maxLinks={maxLinks} onSubmit={onSubmit} onClose={onClose} />),
  );
  return { onClose, onSubmit, root };
}
it("submits multiple independent links and falls back to URL for an empty name", async () => {
  const { root, onSubmit, onClose } = render();
  act(() => {
    input("链接地址 1", " https://example.com/work ");
    input("显示名称 1", "作品网站");
    click("再添加一个链接");
  });
  act(() => input("链接地址 2", "https://github.com/example"));
  await act(async () => {
    click("添加 2 个链接");
    await Promise.resolve();
  });
  expect(onSubmit).toHaveBeenCalledWith([
    { name: "作品网站", url: "https://example.com/work" },
    { name: "https://github.com/example", url: "https://github.com/example" },
  ]);
  expect(onClose).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
// oxlint-disable-next-line no-script-url -- Regression coverage for rejecting executable URLs.
it.each(["javascript:alert(1)", "file:///tmp/work.pdf", "not-a-url"])(
  "rejects invalid or unsafe URLs: %s",
  async (url) => {
    const { root, onSubmit } = render();
    act(() => input("链接地址 1", url));
    await act(async () => {
      click("添加 1 个链接");
      await Promise.resolve();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    act(() => root.unmount());
  },
);
it("keeps entered links after a failed save, supports retry, and caps rows", async () => {
  const onSubmit = vi
    .fn()
    .mockRejectedValueOnce(new Error("保存失败"))
    .mockImplementationOnce(() => Promise.resolve());
  const { root, onClose } = render(onSubmit, 1);
  expect(document.body.textContent).not.toContain("再添加一个链接");
  act(() => input("链接地址 1", "https://example.com"));
  await act(async () => {
    click("添加 1 个链接");
    await Promise.resolve();
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("保存失败");
  expect(document.querySelector<HTMLInputElement>('[aria-label="链接地址 1"]')?.value).toBe(
    "https://example.com",
  );
  await act(async () => {
    click("添加 1 个链接");
    await Promise.resolve();
  });
  expect(onClose).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
