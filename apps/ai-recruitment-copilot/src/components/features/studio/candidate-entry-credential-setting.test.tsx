// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateEntryCredentialSetting } from "./candidate-entry-credential-setting";

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  pending: false,
  role: "admin" as string | undefined,
}));
vi.mock("@/lib/client/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { role: mocks.role } }, isPending: mocks.pending }),
  },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-has-permission", () => ({ useHasPermission: () => true }));
vi.mock("@/lib/client/workspace-context", () => ({ useWorkspaceSlug: () => "work" }));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: {
            resumes: {
              ":id": {
                "entry-credentials": { $get: mocks.get, $patch: mocks.patch },
              },
            },
          },
        },
      },
    },
  },
}));
vi.mock("@/lib/client/api", () => ({ rpcFetch: (request: Promise<unknown>) => request }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
const initial = { enabled: false, reason: null, updatedAt: null, updatedByName: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.pending = false;
  mocks.get.mockResolvedValue(initial);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  document.body.innerHTML = "";
});

async function render() {
  await act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <CandidateEntryCredentialSetting candidateId="candidate" />
      </QueryClientProvider>,
    );
  });
}
async function waitFor(check: () => void) {
  await vi.waitFor(async () => {
    await act(() => {});
    check();
  });
}
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) {
    throw new Error(`Missing button: ${label}`);
  }
  return found;
}
async function fillReason() {
  await act(() => {
    const input = document.querySelector<HTMLTextAreaElement>("#entry-credential-reason");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      input,
      "测试开启验证",
    );
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("candidate entry credential admin control", () => {
  it("hides the entire control and sends no request for non-platform-admins, including cached data", async () => {
    client.setQueryData(["candidate-entry-policy", "work", "candidate"], initial);
    for (const role of ["user", "owner", "hr", undefined]) {
      mocks.role = role;
      await render();
      expect(document.querySelector('[role="switch"]')).toBeNull();
      expect(document.body.textContent).not.toContain("入场凭据");
    }
    mocks.role = "admin";
    mocks.pending = true;
    await render();
    expect(document.body.textContent).not.toContain("入场凭据");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("starts off, requires a reason and waits for a successful save before displaying enabled", async () => {
    const pending = Promise.withResolvers<unknown>();
    mocks.patch.mockReturnValue(pending.promise);
    await render();
    await waitFor(() => expect(document.querySelector('[role="switch"]')).not.toBeNull());
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]');
    if (!toggle) {
      throw new Error("Missing credential switch");
    }
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(() => toggle.click());
    expect(button("确认开启").disabled).toBe(true);
    await fillReason();
    await act(() => button("确认开启").click());
    await waitFor(() => expect(button("确认开启").disabled).toBe(true));
    expect(mocks.patch).toHaveBeenCalledWith({
      json: { enabled: true, reason: "测试开启验证" },
      param: { id: "candidate", slug: "work" },
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(button("确认开启").disabled).toBe(true);
    expect(button("取消").disabled).toBe(true);
    await act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    mocks.get.mockResolvedValue({ ...initial, enabled: true });
    await act(() => pending.resolve({ ok: true }));
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(mocks.patch).toHaveBeenCalledOnce();
  });

  it("keeps the saved switch state and allows retry after a failed request", async () => {
    mocks.patch.mockRejectedValue(new Error("保存失败"));
    await render();
    await waitFor(() => expect(document.querySelector('[role="switch"]')).not.toBeNull());
    await act(() => document.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await fillReason();
    await act(() => button("确认开启").click());
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("保存失败"));
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("确认开启").disabled).toBe(false);
  });
});
