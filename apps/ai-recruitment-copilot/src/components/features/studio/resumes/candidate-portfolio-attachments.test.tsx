// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidatePortfolioAttachments } from "./candidate-portfolio-attachments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const attachments = [
  { id: "image-id", mimeType: "image/png", name: "作品图.png", size: 10 },
  { id: "document-id", mimeType: "application/pdf", name: "作品说明.pdf", size: 20 },
  { id: "archive-id", mimeType: "application/zip", name: "作品.zip", size: 30 },
];
afterEach(() => {
  document.body.innerHTML = "";
});
function clickButton(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) {
    throw new Error(`Missing button: ${text}`);
  }
  button.click();
}
function render(editing: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onAttachmentsChange = vi.fn();
  const onDelete = vi.fn().mockResolvedValue(null);
  act(() =>
    root.render(
      <CandidatePortfolioAttachments
        attachments={attachments}
        canDelete
        editing={editing}
        onAttachmentsChange={onAttachmentsChange}
        onDelete={onDelete}
        onPendingFilesChange={vi.fn()}
        pendingFiles={[]}
        recordId="candidate-1"
        slug="acme"
      />,
    ),
  );
  return { container, onAttachmentsChange, onDelete, root };
}

describe("CandidatePortfolioAttachments", () => {
  it("shows all file types as rows and confirms before removing a draft attachment", async () => {
    const { container, onAttachmentsChange, root } = render(true);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.textContent).toContain("作品.zip");
    const links = [...container.querySelectorAll("a")].filter((link) =>
      link.href.includes("/candidate-1/portfolio/image-id"),
    );
    expect(links.map((link) => link.textContent)).toEqual(["下载"]);
    expect(
      [...container.querySelectorAll("button")].filter((button) => button.textContent === "查看"),
    ).toHaveLength(3);
    expect(links[0]?.href).toContain("download=1");
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="删除附件 作品图.png"]')?.click(),
    );
    expect(onAttachmentsChange).not.toHaveBeenCalled();
    act(() => clickButton("取消"));
    expect(onAttachmentsChange).not.toHaveBeenCalled();
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="删除附件 作品图.png"]')?.click(),
    );
    await act(async () => {
      clickButton("确认删除");
      await Promise.resolve();
    });
    expect(onAttachmentsChange).toHaveBeenCalledWith(attachments.slice(1));
    act(() => root.unmount());
  });
  it("deletes after confirmation outside candidate edit mode", async () => {
    const { container, onAttachmentsChange, onDelete, root } = render(false);
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="删除附件 作品图.png"]')?.click(),
    );
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => {
      clickButton("确认删除");
      await Promise.resolve();
    });
    expect(onDelete).toHaveBeenCalledWith("image-id");
    expect(onAttachmentsChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
