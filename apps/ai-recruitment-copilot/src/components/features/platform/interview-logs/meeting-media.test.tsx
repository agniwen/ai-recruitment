// @vitest-environment jsdom
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { MeetingMediaPanel } from "./meeting-media";
import { deleteMediaAsset, fetchMediaBlob, fetchMeetingMedia } from "./media-api";
import type { MediaAsset } from "./media-api";
vi.mock("./media-api", () => ({
  deleteMediaAsset: vi.fn(),
  fetchMediaBlob: vi.fn(),
  fetchMeetingMedia: vi.fn(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
enableReactActEnvironment();
const asset: MediaAsset = {
  byteSize: 100,
  capturedAt: "2026-10-09T01:00:00Z",
  contentType: "image/jpeg",
  deletedAt: null,
  deletedBy: null,
  durationMs: null,
  environment: { browserId: "browser-one", fingerprint: "b".repeat(32), ip: "203.0.113.1" },
  errorCode: null,
  id: "sample",
  kind: "image",
  meetingId: "meeting",
  participantIdentity: "candidate_one",
  participantName: "测试候选人",
  participantRole: "candidate",
  participantSid: "PA_1",
  roomSid: "RM_1",
  sha256: "a".repeat(64),
  slot: "1",
  status: "ready",
  trackSid: "TR_1",
};
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
let client: QueryClient;
const revoke = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:private-sample"),
    revokeObjectURL: revoke,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(fetchMeetingMedia).mockResolvedValue({
    counts: [{ count: 1, kind: "image", status: "ready" }],
    page: 1,
    pageSize: 30,
    records: [asset],
    rooms: [],
    total: 1,
  });
  vi.mocked(fetchMediaBlob).mockResolvedValue(new Blob(["test"], { type: "image/jpeg" }));
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  client.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function renderPanel() {
  rendered = await renderInAct(
    <QueryClientProvider client={client}>
      <MeetingMediaPanel meetingId="meeting" />
    </QueryClientProvider>,
  );
  await waitForUi(() => expect(document.body.textContent).toContain("测试候选人"));
}
function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  act(() => button.click());
}
describe("interview media admin panel", () => {
  it("shows device evidence and fetches private bytes only when preview is opened, then releases them", async () => {
    await renderPanel();
    expect(document.body.textContent).toContain("browser-one");
    expect(document.body.textContent).toContain("203.0.113.1");
    expect(document.body.textContent).toContain("b".repeat(32));
    expect(fetchMediaBlob).not.toHaveBeenCalled();
    click("查看截图");
    await waitForUi(() =>
      expect(
        document.querySelector('img[alt="测试候选人的面试摄像头截图"]')?.getAttribute("src"),
      ).toBe("blob:private-sample"),
    );
    expect(fetchMediaBlob).toHaveBeenCalledWith("sample", expect.any(AbortSignal));
    click("Close");
    await waitForUi(() => expect(revoke).toHaveBeenCalledWith("blob:private-sample"));
  });
  it("keeps failed deletion reviewable and prevents duplicate submissions while pending", async () => {
    const deletion = Promise.withResolvers<Awaited<ReturnType<typeof deleteMediaAsset>>>();
    vi.mocked(deleteMediaAsset).mockReturnValue(deletion.promise);
    await renderPanel();
    click("清理文件");
    click("确认清理");
    await waitForUi(() => expect(document.body.textContent).toContain("删除中…"));
    const pending = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("删除中"),
    );
    expect(pending?.disabled).toBe(true);
    act(() => pending?.click());
    expect(deleteMediaAsset).toHaveBeenCalledOnce();
    act(() => deletion.reject(new Error("storage unavailable")));
    await waitForUi(() => expect(document.body.textContent).toContain("确认清理"));
    expect(document.body.textContent).toContain("清理这份留底文件？");
    expect(document.body.textContent).toContain("测试候选人");
  });
});
