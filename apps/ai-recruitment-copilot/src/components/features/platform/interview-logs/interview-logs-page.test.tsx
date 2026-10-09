// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  enableReactActEnvironment,
  renderInAct,
  unmountInAct,
  waitForUi,
} from "@/test-utils/react-act";
import { InterviewLogsPage } from "./interview-logs-page";
import { fetchLoggedMeetings, fetchMeetingTimeline } from "./api";

const router = vi.hoisted(() => ({
  meetingId: undefined as string | undefined,
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({
    useNavigate: () => router.navigate,
    useSearch: () => ({ meetingId: router.meetingId }),
  }),
}));
vi.mock("./api", () => ({ fetchLoggedMeetings: vi.fn(), fetchMeetingTimeline: vi.fn() }));
vi.mock("./meeting-media", () => ({
  MeetingMediaPanel: () => <section aria-label="音视频留底" />,
}));
enableReactActEnvironment();
let rendered: Awaited<ReturnType<typeof renderInAct>> | undefined;
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  router.meetingId = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  if (rendered) {
    await unmountInAct(rendered.root);
  }
  rendered = undefined;
  client.clear();
  document.body.innerHTML = "";
});
async function renderPage() {
  rendered = await renderInAct(
    <QueryClientProvider client={client}>
      <InterviewLogsPage />
    </QueryClientProvider>,
  );
}

describe("platform interview timeline", () => {
  it("navigates from meeting search to the admin timeline", async () => {
    vi.mocked(fetchLoggedMeetings).mockResolvedValue({
      page: 1,
      pageSize: 50,
      records: [
        {
          eventCount: 12,
          fingerprintCount: 1,
          firstReceivedAt: "2026-10-08T01:00:00Z",
          lastReceivedAt: "2026-10-08T02:00:00Z",
          meetingId: "meeting",
          meetingTitle: "Miles 一面",
          organizationId: "org",
          participantCount: 4,
          participants: [
            {
              fingerprints: ["a".repeat(32)],
              identity: "candidate_round",
              name: "Miles",
              role: "candidate",
            },
          ],
          roomName: "human_1",
        },
      ],
      total: 1,
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("Miles 一面"));
    expect(document.body.textContent).toContain("浏览器指纹");
    expect(document.querySelector('button[aria-label*="1 个浏览器指纹"]')).not.toBeNull();
    act(() =>
      [...document.querySelectorAll("button")].find((b) => b.textContent === "查看时间线")?.click(),
    );
    expect(router.navigate).toHaveBeenCalledWith({ search: { meetingId: "meeting" } });
  });
  it("distinguishes RTC evidence from client signals and applies source filters", async () => {
    router.meetingId = "meeting";
    const base = {
      attemptId: "attempt",
      clientSequence: null,
      eventKey: "event",
      id: "event",
      ip: null,
      ipSource: null,
      meetingId: "meeting",
      meetingTitle: "Miles 一面",
      occurredAt: "2026-10-08T01:00:00Z",
      organizationId: "org",
      participantIdentity: "candidate_round",
      participantName: "Miles",
      participantRole: "candidate",
      participantSid: "PA_1",
      receivedAt: "2026-10-08T01:00:00Z",
      roomName: "human_1",
      roomSid: "RM_1",
      tabId: "tab",
      userAgent: null,
      visitId: "visit",
    };
    vi.mocked(fetchMeetingTimeline).mockResolvedValue({
      page: 1,
      pageSize: 50,
      participants: [
        {
          attempts: 2,
          browserIds: ["browser-1"],
          fingerprints: ["a".repeat(32)],
          identity: "candidate_round",
          ips: ["127.0.0.1"],
          name: "Miles",
          role: "candidate",
          userAgents: [
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/153.0.0.0 Safari/537.36",
          ],
          visits: 2,
        },
      ],
      records: [
        {
          ...base,
          details: { reason: "DUPLICATE_IDENTITY" },
          source: "livekit",
          type: "participant_left",
        },
        { ...base, details: {}, id: "other", source: "client", type: "page_exit" },
      ],
      summary: {
        attempts: 1,
        events: 2,
        fingerprints: 1,
        keyEvents: 2,
        lastWebhookAt: base.receivedAt,
        meetingTitle: "Miles 一面",
        roomName: "human_1",
        visits: 1,
      },
      total: 2,
    });
    await renderPage();
    await waitForUi(() =>
      expect(document.querySelector('table[aria-label="事件时间线"] tbody')?.textContent).toContain(
        "DUPLICATE_IDENTITY",
      ),
    );
    const timeline = document.querySelector('table[aria-label="事件时间线"] tbody');
    expect(timeline?.textContent).toContain("客户端上报");
    expect(timeline?.textContent).toContain("LiveKit 确认");
    expect(timeline?.textContent).toContain("相同身份再次入会，旧连接被顶下线");
    const environments = document.querySelector('table[aria-label="参与者与浏览器"]');
    expect(environments?.textContent).toContain("a".repeat(32));
    expect(environments?.textContent).toContain("Chrome 153.0.0.0 · macOS");
    expect(environments?.textContent).toContain("127.0.0.1");
    expect(environments?.querySelector("details")).toBeNull();
    expect(fetchMeetingTimeline).toHaveBeenLastCalledWith(
      "meeting",
      { page: "1", view: "key" },
      expect.any(AbortSignal),
    );
    expect(document.body.textContent).toContain("不能单独证明操作者身份或作弊");
    const source = document.querySelector("select");
    if (!source) {
      throw new Error("Missing source filter");
    }
    act(() => {
      source.value = "livekit";
      source.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      document
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await waitForUi(() =>
      expect(fetchMeetingTimeline).toHaveBeenLastCalledWith(
        "meeting",
        { page: "1", source: "livekit", view: "key" },
        expect.any(AbortSignal),
      ),
    );
    act(() =>
      [...document.querySelectorAll("button")].find((b) => b.textContent === "全部事件")?.click(),
    );
    await waitForUi(() =>
      expect(fetchMeetingTimeline).toHaveBeenLastCalledWith(
        "meeting",
        { page: "1", source: "livekit", view: "all" },
        expect.any(AbortSignal),
      ),
    );
    act(() =>
      environments
        ?.querySelector<HTMLButtonElement>(`button[aria-label="按指纹 ${"a".repeat(32)} 查看事件"]`)
        ?.click(),
    );
    await waitForUi(() =>
      expect(fetchMeetingTimeline).toHaveBeenLastCalledWith(
        "meeting",
        { fingerprint: "a".repeat(32), page: "1", view: "all" },
        expect.any(AbortSignal),
      ),
    );
  });
  it("shows an empty state before collection starts", async () => {
    vi.mocked(fetchLoggedMeetings).mockResolvedValue({
      page: 1,
      pageSize: 50,
      records: [],
      total: 0,
    });
    await renderPage();
    await waitForUi(() => expect(document.body.textContent).toContain("暂无日志"));
  });
});
