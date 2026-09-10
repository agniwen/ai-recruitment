// @vitest-environment jsdom
/* oxlint-disable anti-slop/no-module-mocking -- This boundary test replaces external SDK hooks and I/O so it can exercise ChatWorkspace's real branch and preload timing. */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatWorkspace from "./chat-workspace";

const mocks = vi.hoisted(() => ({
  // SAFETY: The test mutates this slot only between renders to model useChat's optional Error.
  chatError: undefined as Error | undefined,
  clearError: vi.fn(),
  fetchConversation: vi.fn(),
  getOrCreateChat: vi.fn(),
  hasChat: vi.fn(),
  navigate: vi.fn(),
  patchConversation: vi.fn(),
  preloadConversationThread: vi.fn(),
  regenerate: vi.fn(),
  requestResumeChatTitle: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  setSessionTitle: vi.fn(),
  toastError: vi.fn(),
  upsertConversation: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    clearError: mocks.clearError,
    error: mocks.chatError,
    messages: [],
    regenerate: mocks.regenerate,
    setMessages: mocks.setMessages,
    status: "ready",
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="runtime-provider">{children}</div>
  ),
}));

vi.mock("@assistant-ui/react-ai-sdk", () => ({
  useAISDKRuntime: () => ({ id: "runtime" }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/assistant-ui/recruiting-thread", () => ({
  NewRecruitingThread: () => <div>新对话</div>,
  RecruitingCopilotContextProvider: ({ children }: { children: React.ReactNode }) => children,
  RecruitingThread: () => <div>聊天记录</div>,
  RecruitingToolRenderers: () => null,
}));

vi.mock("@/lib/client/api", () => ({
  fetchConversation: mocks.fetchConversation,
  patchConversation: mocks.patchConversation,
  requestResumeChatTitle: mocks.requestResumeChatTitle,
  upsertConversation: mocks.upsertConversation,
}));

vi.mock("@/lib/client/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));

vi.mock("@/lib/client/workspace-context", () => ({
  useWorkspaceSlug: () => "default",
}));

vi.mock("./chat-header", () => ({
  getVisibleConversationTitle: ({ title }: { title: string }) => title,
  useSetChatHeaderTitle: () => mocks.setSessionTitle,
}));

vi.mock("./lib/chat-meta", () => ({ setChatMeta: vi.fn() }));

vi.mock("./lib/chat-registry", () => ({
  getOrCreateChat: mocks.getOrCreateChat,
  hasChat: mocks.hasChat,
}));

// SAFETY: React 19 reads this documented test-environment flag from the global object.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderWorkspace(initialSessionId: string | null) {
  await act(async () => {
    root.render(<ChatWorkspace initialSessionId={initialSessionId} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.chatError = undefined;
  mocks.getOrCreateChat.mockReturnValue({ sendMessage: mocks.sendMessage });
  mocks.hasChat.mockReturnValue(false);
  mocks.patchConversation.mockResolvedValue(null);
  mocks.preloadConversationThread.mockResolvedValue(null);
  mocks.requestResumeChatTitle.mockResolvedValue({ title: "候选人筛选" });
  mocks.sendMessage.mockResolvedValue(null);
  mocks.upsertConversation.mockResolvedValue(null);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ChatWorkspace error notifications", () => {
  it("reports chat failures with an error toast instead of an inline error bar", async () => {
    mocks.chatError = new Error("模型请求失败");

    await renderWorkspace(null);

    expect(mocks.toastError).toHaveBeenCalledWith("请求失败，这一步没有完成，请稍后重试。", {
      id: "recruiting-chat-error",
    });
    expect(mocks.clearError).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("请求失败，这一步没有完成。");
  });

  it("reports history failures with an error toast instead of inline content", async () => {
    mocks.fetchConversation.mockRejectedValue(new Error("network unavailable"));

    await renderWorkspace("conversation-1");

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("无法加载聊天记录，请稍后重试。", {
        id: "recruiting-chat-error",
      });
    });
    expect(container.textContent).not.toContain("无法加载聊天记录，请稍后重试。");
  });
});
