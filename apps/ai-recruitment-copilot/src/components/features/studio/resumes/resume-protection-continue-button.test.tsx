// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { ResumeProtectionContinueButton } from "./resume-protection-continue-button";

const mocks = vi.hoisted(() => ({
  allowed: true,
  post: vi.fn(),
  role: "member",
  userId: "uploader",
}));
vi.mock("@/lib/client/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: mocks.userId } } }) },
}));
vi.mock("@/hooks/use-has-permission", () => ({
  useHasPermission: (_resource: string, action: string) => mocks.allowed && action === "create",
}));
vi.mock("@/lib/client/workspace-context", () => ({
  useOptionalWorkspaceMemberRole: () => mocks.role,
  useWorkspaceSlug: () => "workspace",
}));
vi.mock("@/lib/client/rpc", () => ({
  rpc: {
    api: {
      w: {
        ":slug": {
          studio: { resumes: { ":id": { protection: { continue: { $post: mocks.post } } } } },
        },
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const record = {
  candidateName: "沈炼",
  createdBy: "uploader",
  id: "candidate",
  jobDescriptionId: "job",
  outcome: "in_pipeline",
  pipelineStage: "ai_review",
  resumeAdmissionStatus: "protected",
  resumeParseStatus: "ready",
  resumeProtection: { expiresAt: "2099-11-06T06:00:00Z", ownerName: "原推荐人" },
} as ResumeLibraryListRecord;

enableReactActEnvironment();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.role = "member";
  mocks.userId = "uploader";
  mocks.post.mockResolvedValue(Response.json({ analysisQueued: true, status: "accepted" }));
});
afterEach(() => {
  document.body.innerHTML = "";
});

async function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const rendered = await renderInAct(
    <QueryClientProvider client={client}>
      <ResumeProtectionContinueButton record={record} />
    </QueryClientProvider>,
  );
  return { ...rendered, client, container: document.body, invalidate };
}
function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!found) {
    throw new Error(`Missing button: ${label}`);
  }
  return found;
}

describe("continue recommendation confirmation", () => {
  it.each(["permission", "different uploader"])("hides the action for %s", async (reason) => {
    if (reason === "permission") {
      mocks.allowed = false;
    } else {
      mocks.userId = "colleague";
    }
    const { container, root, client } = await renderButton();
    expect(container.textContent).toBe("");
    await unmountInAct(root);
    client.clear();
  });

  it("requires only confirmation and refreshes list/detail after submission", async () => {
    const { container, root, client, invalidate } = await renderButton();
    try {
      act(() => button(container, "继续推荐").click());
      await waitForUi(() => expect(button(container, "确认继续推荐").disabled).toBe(false));
      expect(container.textContent).toContain("仍处于原推荐人的推荐保护期");
      expect(mocks.post).not.toHaveBeenCalled();
      expect(container.querySelector("select, [role=combobox]")).toBeNull();
      expect(container.querySelector("[role=alertdialog]")).not.toBeNull();
      expect(container.querySelector("[data-slot=modal-body]")).toBeNull();
      act(() => button(container, "确认继续推荐").click());
      await waitForUi(() =>
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["studio-resumes", "workspace"] }),
      );
      expect(mocks.post).toHaveBeenCalledExactlyOnceWith({
        json: { confirmed: true },
        param: { id: "candidate", slug: "workspace" },
      });
      expect(container.textContent).not.toContain("确认继续推荐");
      expect(container.textContent).not.toContain("匹配依据");
    } finally {
      await unmountInAct(root);
      client.clear();
    }
  });

  it("lets the user cancel without submitting", async () => {
    const { container, root, client } = await renderButton();
    try {
      act(() => button(container, "继续推荐").click());
      act(() => button(container, "取消").click());
      expect(mocks.post).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("确认继续推荐");
    } finally {
      await unmountInAct(root);
      client.clear();
    }
  });

  it("keeps the confirmation open after an error so it can be retried", async () => {
    mocks.post.mockRejectedValue(new Error("暂时无法提交"));
    const { container, root, client } = await renderButton();
    try {
      act(() => button(container, "继续推荐").click());
      await waitForUi(() => expect(button(container, "确认继续推荐").disabled).toBe(false));
      act(() => button(container, "确认继续推荐").click());
      await waitForUi(() => expect(mocks.post).toHaveBeenCalledOnce());
      await waitForUi(() => expect(button(container, "确认继续推荐").disabled).toBe(false));
    } finally {
      await unmountInAct(root);
      client.clear();
    }
  });
});
