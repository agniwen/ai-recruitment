// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JOB_DESCRIPTION_DUPLICATE_CODE } from "@arc/shared/job-descriptions";
import { Modal } from "@/components/ui/modal";
import { createJobDescriptionFormValues } from "./job-description-form-values";
import { useJobDescriptionSave } from "./use-job-description-save";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ error: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            "job-descriptions": { $post: mocks.post, ":id": { $patch: mocks.patch } },
          },
        },
      },
    },
  },
}));

const body = { ...createJobDescriptionFormValues(), departmentId: "dept", name: "前端工程师" };
const duplicateResponse = () =>
  Response.json(
    {
      code: JOB_DESCRIPTION_DUPLICATE_CODE,
      error: "发现重复岗位",
    },
    { status: 409 },
  );
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockReset().mockResolvedValue(Response.json({ id: "created" }, { status: 201 }));
  mocks.patch.mockReset().mockResolvedValue(Response.json({ id: "updated" }));
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
});

function render(recordId?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  let save: ReturnType<typeof useJobDescriptionSave>["save"];
  function Harness({ open }: { open: boolean }) {
    const result = useJobDescriptionSave({ open, recordId, slug: "work" });
    ({ save } = result);
    return (
      <Modal open={open} onOpenChange={() => {}} title="岗位表单">
        {result.duplicateDialog}
      </Modal>
    );
  }
  const update = (open: boolean) => act(() => root.render(<Harness open={open} />));
  update(true);
  return { save: () => save(body), update };
}
function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  button.click();
}

it.each([undefined, "existing"])("saves %s without a confirmation when unique", async (id) => {
  const view = render(id);
  await act(async () => expect(await view.save()).toBe(true));
  expect(id ? mocks.patch : mocks.post).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it("cancel leaves the form open and does not send a force save", async () => {
  mocks.post.mockResolvedValueOnce(duplicateResponse());
  const view = render();
  let pending = Promise.resolve(false);
  await act(async () => {
    pending = view.save();
    await Promise.resolve();
  });
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("发现重复岗位");
  await act(async () => {
    click("返回修改");
    await pending;
  });
  expect(await pending).toBe(false);
  expect(mocks.post).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("岗位表单");
});

it.each([undefined, "existing"])(
  "confirms the same payload for %s and prevents a second submission",
  async (id) => {
    const request = id ? mocks.patch : mocks.post;
    request.mockResolvedValueOnce(duplicateResponse());
    const view = render(id);
    let pending = Promise.resolve(false);
    await act(async () => {
      pending = view.save();
      await Promise.resolve();
    });
    expect(await view.save()).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    await act(async () => {
      click("仍然保存");
      expect(await pending).toBe(true);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toEqual({
      json: { ...body, forceSaveDuplicate: true },
      param: id ? { id, slug: "work" } : { slug: "work" },
    });
  },
);

it("shows unrelated conflicts as errors, without a duplicate confirmation", async () => {
  mocks.post.mockResolvedValueOnce(Response.json({ error: "HC 不足" }, { status: 409 }));
  const view = render();
  await act(async () => expect(await view.save()).toBe(false));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(mocks.error).toHaveBeenCalledWith("HC 不足");
});

it("allows a fresh attempt after force save fails", async () => {
  mocks.post
    .mockResolvedValueOnce(duplicateResponse())
    .mockRejectedValueOnce(new Error("网络不可用"));
  const view = render();
  let pending = Promise.resolve(false);
  await act(async () => {
    pending = view.save();
    await Promise.resolve();
  });
  await act(async () => {
    click("仍然保存");
    expect(await pending).toBe(false);
  });
  expect(mocks.error).toHaveBeenCalledWith("网络不可用");
  await act(async () => expect(await view.save()).toBe(true));
});

it("closing the form resolves a pending confirmation without saving", async () => {
  mocks.post.mockResolvedValueOnce(duplicateResponse());
  const view = render();
  let pending = Promise.resolve(false);
  await act(async () => {
    pending = view.save();
    await Promise.resolve();
  });
  view.update(false);
  expect(await pending).toBe(false);
  expect(mocks.post).toHaveBeenCalledOnce();
});

it("ignores a late duplicate response after close and reopen", async () => {
  const response = Promise.withResolvers<Response>();
  mocks.post.mockReturnValueOnce(response.promise);
  const view = render();
  const pending = view.save();
  await Promise.resolve();
  view.update(false);
  view.update(true);
  await act(async () => {
    response.resolve(duplicateResponse());
    await pending;
  });
  expect(await pending).toBe(false);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
