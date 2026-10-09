// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EntityDeleteDialog } from "./entity-delete-dialog";
import { useEntityCrud } from "./use-entity-crud";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
});

interface RecordItem {
  id: string;
  name: string;
}
function render(confirmDisabled = false) {
  const request = Promise.withResolvers<Response>();
  const deleteEntity = vi.fn(() => request.promise);
  const invalidate = vi.fn();
  const onClose = vi.fn();
  const state: { current?: ReturnType<typeof useEntityCrud<RecordItem, RecordItem>> } = {};
  function Harness() {
    const crud = useEntityCrud<RecordItem, RecordItem>({
      deleteEntity,
      invalidate,
      messages: { deleteSuccess: "在招岗位已删除" },
    });
    state.current = crud;
    return (
      <EntityDeleteDialog
        confirmDisabled={confirmDisabled}
        description="即将删除测试岗位"
        isPending={crud.isDeleting}
        onClose={() => {
          onClose();
          crud.setDeleteRecord(null);
        }}
        onConfirm={crud.handleDelete}
        record={crud.deleteRecord}
        title="确认删除这个在招岗位？"
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<Harness />));
  const getCrud = () => {
    if (!state.current) {
      throw new Error("Harness has not rendered");
    }
    return state.current;
  };
  act(() => getCrud().setDeleteRecord({ id: "job", name: "测试岗位" }));
  return { deleteEntity, getCrud, invalidate, onClose, request };
}
function button(label: string) {
  const result = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!result) {
    throw new Error(`Missing button: ${label}`);
  }
  return result;
}

it("shows loading, blocks duplicate submits and every dismiss action until success", async () => {
  const view = render();
  act(() => {
    button("删除").click();
    void view.getCrud().handleDelete();
  });
  expect(button("删除中…").disabled).toBe(true);
  expect(button("取消").disabled).toBe(true);
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  act(() => {
    button("删除中…").click();
    button("取消").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    document.querySelector<HTMLElement>('[data-slot="alert-dialog-overlay"]')?.click();
  });
  expect(view.onClose).not.toHaveBeenCalled();
  expect(view.getCrud().deleteRecord?.id).toBe("job");
  expect(view.deleteEntity).toHaveBeenCalledOnce();
  expect(view.invalidate).not.toHaveBeenCalled();
  await act(async () => {
    view.request.resolve(Response.json({ success: true }));
    await view.request.promise;
  });
  expect(view.getCrud().deleteRecord).toBeNull();
  expect(view.getCrud().isDeleting).toBe(false);
  expect(toast.success).toHaveBeenCalledWith("在招岗位已删除");
  expect(view.invalidate).toHaveBeenCalledOnce();
});

it.each(["http", "network"])(
  "keeps the dialog open after a %s failure and allows retry",
  async (kind) => {
    const view = render();
    act(() => button("删除").click());
    await act(async () => {
      if (kind === "http") {
        view.request.resolve(Response.json({ error: "岗位仍有关联简历" }, { status: 409 }));
      } else {
        view.request.reject(new TypeError("Failed to fetch"));
      }
      await view.request.promise.catch(() => {});
    });
    expect(view.getCrud().deleteRecord?.id).toBe("job");
    expect(button("删除").disabled).toBe(false);
    expect(button("取消").disabled).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(kind === "http" ? "岗位仍有关联简历" : "删除失败");
    expect(view.invalidate).not.toHaveBeenCalled();
    view.deleteEntity.mockResolvedValueOnce(Response.json({ success: true }));
    await act(async () => {
      button("删除").click();
      await Promise.resolve();
    });
    expect(view.deleteEntity).toHaveBeenCalledTimes(2);
    expect(view.getCrud().deleteRecord).toBeNull();
  },
);

it.each(["cancel", "escape"])("allows %s dismissal before submitting", (action) => {
  const view = render();
  act(() => {
    if (action === "cancel") {
      button("取消").click();
    } else {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    }
  });
  expect(view.onClose).toHaveBeenCalledOnce();
  expect(view.getCrud().deleteRecord).toBeNull();
  expect(view.deleteEntity).not.toHaveBeenCalled();
});

it("preserves the disabled state for jobs with linked resumes without locking cancellation", () => {
  const view = render(true);
  expect(button("删除").disabled).toBe(true);
  expect(button("取消").disabled).toBe(false);
  act(() => button("删除").click());
  expect(view.deleteEntity).not.toHaveBeenCalled();
  act(() => button("取消").click());
  expect(view.getCrud().deleteRecord).toBeNull();
});
